import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useFocusStore } from '../store/focusStore';
import { labelForProcess } from '../lib/processLabels';
import { groupByProject, type ProjectGroup } from '../lib/projectGroup';
import { sortGroupProcs, sortGroups, type GroupSortKey, type SortDir } from '../lib/groupSort';
import { Code, FolderIcon, FolderOpen, PackageIcon, Terminal } from './icons';
import { ipc } from '../lib/ipc';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { IconButton } from './ui/IconButton';
import { buildProcessMenuItems } from '../lib/processMenu';
import { kindColorOf } from '../lib/kindColors';
import { copyText, openTargetOrNotify } from '../lib/shellClient';
import { notify } from '../lib/notify';

const UNGROUPED = '未分组';
// 未分组组展开时，对组内启发式 cwd 为空的进程按需拉精确 cwd（PEB 直读）。
// 分批限流：每批最多 BATCH_SIZE 个并发 IPC + PEB 行走，批间 BATCH_DELAY_MS 间隔，
// 避免 N 个进程瞬时并发造成 main 进程尖刺。
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 50;
// 虚拟滚动固定行高（py-2 + text-sm ≈ 37px）：与 ProcessTable 的 ROW_HEIGHT 同步，改行高时两处需同时更新。
const ROW_HEIGHT = 37;

interface ProjectGroupViewProps {
  /** 多选模式（main 合入）：true 时行首渲染 checkbox，点击行=切换选择；false 时点击行=聚焦。 */
  multiSelectEnabled?: boolean;
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: (name: string, pids: number[]) => void;
  onKillTree: (pid: number, name: string) => void;
}

function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) : mb.toFixed(1);
}

/** 组头行（H3 从 GroupRow 拆出，支撑虚拟化逐行渲染）。 */
const GroupHeaderRow = memo(function GroupHeaderRow({
  name,
  dir,
  procCount,
  totalMemory,
  isExpanded,
  multiSelectEnabled,
  onToggle,
  onKillGroup,
}: {
  name: string;
  dir: string | null;
  procCount: number;
  totalMemory: number;
  isExpanded: boolean;
  multiSelectEnabled: boolean;
  onToggle: () => void;
  onKillGroup: () => void;
}) {
  return (
    <tr className="border-b border-line bg-surface-raised/60 transition-colors duration-150 hover:bg-surface-raised/80">
      {multiSelectEnabled && <td className="px-1 py-2" />}
      <td className="px-2 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-sm font-medium text-content-primary"
          title={dir || '未分组进程'}
        >
          <span className="w-4 text-xs text-content-muted">
            {procCount > 0 ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <span className="text-content-muted">{dir ? <FolderIcon /> : <PackageIcon />}</span>
          <span className="truncate max-w-[260px]">{name}</span>
          <span className="ml-1 text-xs font-normal text-content-muted">
            ({procCount} 进程 · 合计 {formatMem(totalMemory)})
          </span>
        </button>
      </td>
      <td className="px-2 py-2" />
      <td className="px-2 py-2" />
      <td className="px-2 py-2 text-right font-mono text-content-secondary">
        {formatMem(totalMemory)}
      </td>
      <td className="px-2 py-2 text-right text-xs text-content-muted" colSpan={3}>
        {dir || '—'}
      </td>
      <td className="px-2 py-2 text-right">
        <span className="mr-1 inline-flex items-center gap-0.5 align-middle">
          <IconButton label="打开项目文件夹" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrNotify('folder', dir)}><FolderOpen /></IconButton>
          <IconButton label="在项目目录打开终端" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrNotify('terminal', dir)}><Terminal /></IconButton>
          <IconButton label="在编辑器打开项目" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrNotify('editor', dir)}><Code /></IconButton>
        </span>
        <button
          onClick={onKillGroup}
          className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
          title={`结束本组全部 ${procCount} 个进程`}
        >
          结束本组
        </button>
      </td>
    </tr>
  );
});

/** 组内进程行（H3 拆出 + main 多选/键盘导航融合）。 */
const GroupProcRow = memo(function GroupProcRow({
  proc,
  cpu,
  multiSelectEnabled,
  isSelected,
  isNavFocused,
  isKeyboardEntry,
  isFocusedGlobal,
  onActivate,
  onToggleSelect,
  onRowKeyDown,
  onKillSingle,
  onContextMenuRow,
}: {
  proc: ProcessInfo;
  cpu: number;
  multiSelectEnabled: boolean;
  isSelected: boolean;
  isNavFocused: boolean;
  isKeyboardEntry: boolean;
  isFocusedGlobal: boolean;
  onActivate: (pid: number) => void;
  onToggleSelect: (pid: number) => void;
  onRowKeyDown: (e: React.KeyboardEvent, proc: ProcessInfo) => void;
  onKillSingle: (pid: number, name: string) => void;
  onContextMenuRow: (e: React.MouseEvent, proc: ProcessInfo) => void;
}) {
  const label = labelForProcess(proc.name, proc.cmdline);
  return (
    <tr
      role="row"
      aria-selected={multiSelectEnabled ? isSelected : undefined}
      tabIndex={isNavFocused || isKeyboardEntry ? 0 : -1}
      data-pid={proc.pid}
      data-row-focused={isNavFocused ? 'true' : undefined}
      className={`border-b border-line transition-colors duration-200 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60 ${
        multiSelectEnabled && isSelected ? 'bg-gradient-to-r from-accent/15 to-transparent border-l-[3px] border-l-accent' : ''
      } ${isFocusedGlobal ? 'ring-2 ring-inset ring-accent/60' : ''}`}
      onClick={() => onActivate(proc.pid)}
      onKeyDown={(e) => onRowKeyDown(e, proc)}
      onContextMenu={(e) => onContextMenuRow(e, proc)}
    >
      {multiSelectEnabled && (
        <td role="gridcell" className="px-1 py-2">
          <input
            type="checkbox"
            aria-label={`选择 ${proc.name}（PID ${proc.pid}）`}
            checked={isSelected}
            onChange={() => onToggleSelect(proc.pid)}
            className="accent-accent"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </td>
      )}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1" style={{ paddingLeft: 24 }}>
          <span className="text-content-primary truncate max-w-[200px]">
            {proc.name}
          </span>
        </div>
      </td>
      <td className="px-2 py-2">
        {label && (
          <span className={`rounded px-1 text-[10px] ${kindColorOf(label.kind)}`}>
            {label.label}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right font-mono text-content-primary">
        {cpu.toFixed(1)}
      </td>
      <td className="px-2 py-2 text-right font-mono text-content-primary">
        {formatMem(proc.workingSetBytes)}
      </td>
      <td className="px-2 py-2 text-right font-mono text-content-secondary">
        {proc.pid}
      </td>
      <td className="px-2 py-2 text-right font-mono text-content-secondary">
        {proc.threadCount}
      </td>
      <td
        className="px-2 py-2 font-mono text-content-muted truncate max-w-[300px] text-xs"
        title={proc.cmdline}
      >
        {proc.cmdline || '—'}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKillSingle(proc.pid, proc.name);
          }}
          className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
        >
          结束
        </button>
      </td>
    </tr>
  );
});

// 可排序表头列（H3）：name/cpu/memory/pid，点击切换升降序
const SORTABLE_HEADERS: { key: GroupSortKey; label: string; cls: string }[] = [
  { key: 'name', label: '项目 / 名称', cls: 'px-3 py-2 font-medium' },
  { key: 'cpu', label: 'CPU%', cls: 'w-16 px-3 py-2 font-medium text-right' },
  { key: 'memory', label: '内存/MB', cls: 'w-20 px-3 py-2 font-medium text-right' },
  { key: 'pid', label: 'PID', cls: 'w-16 px-3 py-2 font-medium text-right' },
];

type FlatRow =
  | { type: 'group'; key: string; group: ProjectGroup; procs: ProcessInfo[] }
  | { type: 'proc'; key: string; proc: ProcessInfo };

export function ProjectGroupView({ multiSelectEnabled = false, onKillSingle, onKillGroup, onKillTree }: ProjectGroupViewProps) {
  const {
    processes,
    cpuMap,
    filter,
    expandedGroups,
    toggleGroup,
    preciseCwdByPid,
    setPreciseCwd,
    selectedPids,
    toggleSelect,
    selectAll,
  } = useProcessPanelStore();

  // Apply the same filter as the tree view (name/cmdline/pid，额外含 cwd)。
  const filtered = useMemo(() => {
    if (!filter.trim()) return processes;
    const q = filter.toLowerCase();
    return processes.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.cmdline.toLowerCase().includes(q) ||
        p.cwd.toLowerCase().includes(q) ||
        String(p.pid).includes(q),
    );
  }, [processes, filter]);

  // 分组键优先用精确 cwd（旁路缓存），缺失回退启发式
  const groups = useMemo(() => groupByProject(filtered, preciseCwdByPid), [filtered, preciseCwdByPid]);

  // ── 排序（H3）：默认 null 保持原序（组按大小降序、组内采集序），点表头进入排序 ──
  const [sort, setSort] = useState<{ key: GroupSortKey; dir: SortDir } | null>(null);
  const toggleSort = useCallback((key: GroupSortKey) => {
    setSort((s) => {
      if (s?.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null; // 第三次点击回到默认原序
    });
  }, []);
  const sortedGroups = useMemo(
    () => (sort ? sortGroups(groups, sort.key, sort.dir) : groups),
    [groups, sort],
  );

  // 未分组组展开时，对组内启发式 cwd 为空的进程按需拉精确 cwd。
  // 精确值到达后写入 store 缓存，分组重算时这些进程会从「未分组」迁到真实组。
  // 跟踪展开态防陈旧：组收起/组件卸载时丢弃 in-flight 结果。
  const ungroupedExpanded = expandedGroups.has(UNGROUPED);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!ungroupedExpanded) return;
    cancelledRef.current = false;
    // 候选：启发式 cwd 为空 且 尚无精确缓存 的 pid
    const candidates = processes.filter((pr) => !pr.cwd?.trim() && !(pr.pid in preciseCwdByPid));
    if (candidates.length === 0) return;
    let idx = 0;
    const runBatch = async () => {
      while (idx < candidates.length) {
        if (cancelledRef.current) return;
        const batch = candidates.slice(idx, idx + BATCH_SIZE);
        idx += BATCH_SIZE;
        // 并发拉一批，结果分别写缓存（null/失败静默跳过，保持启发式回退）
        await Promise.all(
          batch.map(async (pr) => {
            try {
              const cwd = await ipc.fetchCwd(pr.pid);
              if (cancelledRef.current) return;
              if (cwd) setPreciseCwd(pr.pid, cwd);
            } catch {
              /* 静默：受保护/已退出进程，保持启发式回退 */
            }
          }),
        );
        if (idx < candidates.length && !cancelledRef.current) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    };
    runBatch();
    return () => { cancelledRef.current = true; };
    // processes/pr preciseCwdByPid 快照取本次展开时刻；不监听其变化避免重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ungroupedExpanded, setPreciseCwd]);

  // For inline pid list under each group: map pid -> process.
  const procByPid = useMemo(() => {
    const m = new Map<number, ProcessInfo>();
    for (const p of filtered) m.set(p.pid, p);
    return m;
  }, [filtered]);

  const onToggle = useCallback((name: string) => toggleGroup(name), [toggleGroup]);

  // ── 扁平化行（H3）：组头 + 已展开组的排序后进程行，供虚拟化/直接渲染共用 ──
  const flatRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const g of sortedGroups) {
      const groupKey = g.dir ?? g.name; // identity 键：规范化 dir（未分组回退 name）
      const procs = g.pids
        .map((pid) => procByPid.get(pid))
        .filter((x): x is ProcessInfo => !!x);
      const sortedProcs = sort ? sortGroupProcs(procs, sort.key, sort.dir, cpuMap) : procs;
      out.push({ type: 'group', key: `g:${groupKey}`, group: g, procs: sortedProcs });
      if (expandedGroups.has(groupKey)) {
        for (const p of sortedProcs) {
          out.push({ type: 'proc', key: `p:${groupKey}:${p.pid}`, proc: p });
        }
      }
    }
    return out;
  }, [sortedGroups, procByPid, expandedGroups, sort, cpuMap]);

  // 可见进程列表（键盘导航/全选的行域，main 多选融合；顺序跟随排序后的 flatRows）
  const visibleProcs = useMemo(
    () => flatRows.filter((r): r is Extract<FlatRow, { type: 'proc' }> => r.type === 'proc').map((r) => r.proc),
    [flatRows],
  );

  // ── 虚拟滚动（H3，>100 行启用；spacer 方案与 ProcessTable 同构）──
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = flatRows.length > 100;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? flatRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const padTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const padBottom = shouldVirtualize && virtualItems.length > 0
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
    : 0;
  const visibleRows: FlatRow[] = shouldVirtualize
    ? virtualItems.map((vi) => flatRows[vi.index]!)
    : flatRows;

  // ── 多选/键盘导航/全局聚焦（main 多选融合 + ProcessTable 虚拟化焦点滚动范式）──
  const focusedPid = useFocusStore((s) => s.focusedPid);
  const focus = useFocusStore((s) => s.focus);

  const onActivate = useCallback((pid: number) => {
    if (multiSelectEnabled) toggleSelect(pid);
    focus(pid, 'process');
  }, [multiSelectEnabled, toggleSelect, focus]);
  const onToggleSelect = useCallback((pid: number) => toggleSelect(pid), [toggleSelect]);

  const [navFocusPid, setNavFocusPid] = useState<number | null>(null);
  const navFocusVisible = navFocusPid !== null && visibleProcs.some((proc) => proc.pid === navFocusPid);
  const effectiveNavFocusPid = navFocusVisible ? navFocusPid : (visibleProcs[0]?.pid ?? null);
  const visibleProcsRef = useRef(visibleProcs);
  visibleProcsRef.current = visibleProcs;
  const flatRowsRef = useRef(flatRows);
  flatRowsRef.current = flatRows;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const lastDomFocusPidRef = useRef<number | null>(null);

  // 行集变化后恢复 DOM 焦点（原焦点行消失时落到 effectiveNavFocusPid）
  useEffect(() => {
    const previousPid = lastDomFocusPidRef.current;
    if (previousPid == null || navFocusVisible || effectiveNavFocusPid == null) return;
    const active = document.activeElement;
    if (active !== document.body && !tableRef.current?.contains(active)) return;
    tableRef.current
      ?.querySelector<HTMLTableRowElement>(`[data-pid="${effectiveNavFocusPid}"]`)
      ?.focus({ preventScroll: true });
    lastDomFocusPidRef.current = effectiveNavFocusPid;
  }, [effectiveNavFocusPid, navFocusVisible]);

  // 键盘焦点变化时滚动：虚拟化用 scrollToIndex（焦点行可能未渲染），非虚拟化 scrollIntoView。
  // 只挂在 navFocusPid 上——挂在 virtualItems 上会把用户滚动"拉回"焦点行。
  useEffect(() => {
    if (navFocusPid == null) return;
    if (shouldVirtualize) {
      const idx = flatRowsRef.current.findIndex((r) => r.type === 'proc' && r.proc.pid === navFocusPid);
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [navFocusPid, shouldVirtualize, virtualizer]);

  // 焦点行 DOM 挂载后 focus（roving tabindex 配套）。依赖 virtualItems：
  // 虚拟化下 scrollToIndex 后焦点行才渲染，渲染后本 effect 重跑补上 focus。
  useEffect(() => {
    if (navFocusPid == null) return;
    const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
    el?.focus({ preventScroll: true });
  }, [navFocusPid, virtualItems]);

  // 全局聚焦（C）：focusedPid 变化时滚动到该行（外部面板点击触发），与键盘焦点滚动分开
  useEffect(() => {
    if (focusedPid == null) return;
    const idx = flatRowsRef.current.findIndex((r) => r.type === 'proc' && r.proc.pid === focusedPid);
    if (idx === -1) return;
    if (shouldVirtualize) {
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>(`[data-pid="${focusedPid}"]`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedPid, shouldVirtualize, virtualizer]);

  const onRowKeyDown = useCallback((e: React.KeyboardEvent, proc: ProcessInfo) => {
    const rows = visibleProcsRef.current;
    const index = rows.findIndex((row) => row.pid === proc.pid);
    if (index === -1) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index < rows.length - 1) setNavFocusPid(rows[index + 1]!.pid);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) setNavFocusPid(rows[index - 1]!.pid);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (rows.length > 0) setNavFocusPid(rows[0]!.pid);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (rows.length > 0) setNavFocusPid(rows[rows.length - 1]!.pid);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate(proc.pid);
    }
  }, [onActivate]);

  // 全选可见行（多选模式表头 checkbox）
  const visiblePids = useMemo(() => visibleProcs.map((p) => p.pid), [visibleProcs]);
  const allVisibleSelected = visiblePids.length > 0 && visiblePids.every((pid) => selectedPids.has(pid));
  // UX-21：部分选中时表头全选框呈半选态（indeterminate）
  const selectAllRef = useRef<HTMLInputElement>(null);
  const someVisibleSelected = !allVisibleSelected && visiblePids.some((pid) => selectedPids.has(pid));
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  // ── 右键上下文菜单（与 ProcessTable 同构，但项目视图无树信息，结束进程树按 pid>4 放行） ──
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const onContextMenuRow = useCallback((e: React.MouseEvent, proc: ProcessInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, proc });
  }, []);
  // 与 ProcessTable 共用构建器；项目视图无树信息，hasChildren 传 true（按 pid>4 放行）
  // UX-22：复制失败不再静默（剪贴板被占用/权限被禁时用户需要知道）
  const copyTextWithFeedback = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => notify.error('复制失败：剪贴板不可用'));
  }, []);

  const menuItems: ContextMenuItem[] = menu ? buildProcessMenuItems(
    menu.proc,
    { hasChildren: true },
    {
      onOpenTarget: (kind, path) => void openTargetOrNotify(kind, path),
      onCopy: copyTextWithFeedback,
      onKillSingle,
      onKillTree,
    },
  ) : [];

  const colSpan = multiSelectEnabled ? 9 : 8;


  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-auto">
      <table
        ref={tableRef}
        className="w-full text-sm"
        onFocusCapture={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-pid]');
          if (row) lastDomFocusPidRef.current = Number(row.dataset.pid);
        }}
      >
        <thead className="sticky top-0 z-10 bg-surface-raised text-left text-xs uppercase text-content-muted">
          <tr>
            {multiSelectEnabled && (
              <th className="w-8 px-1 py-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="全选可见行"
                  checked={allVisibleSelected}
                  onChange={() => {
                    if (allVisibleSelected) {
                      visiblePids.forEach((pid) => {
                        if (selectedPids.has(pid)) toggleSelect(pid);
                      });
                    } else {
                      selectAll([...new Set([...selectedPids, ...visiblePids])]);
                    }
                  }}
                  className="accent-accent"
                />
              </th>
            )}
            {SORTABLE_HEADERS.slice(0, 1).map((h) => (
              <th key={h.key} className={h.cls}>
                <button
                  onClick={() => toggleSort(h.key)}
                  className="hover:text-content-primary"
                  title={`按${h.label}排序`}
                >
                  {h.label}
                  {sort?.key === h.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th className="w-32 px-3 py-2 font-medium">标签</th>
            {SORTABLE_HEADERS.slice(1).map((h) => (
              <th key={h.key} className={h.cls}>
                <button
                  onClick={() => toggleSort(h.key)}
                  className="hover:text-content-primary"
                  title={`按${h.label}排序`}
                >
                  {h.label}
                  {sort?.key === h.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th className="w-14 px-3 py-2 font-medium text-right">线程</th>
            <th className="px-3 py-2 font-medium">命令行</th>
            <th className="w-20 px-3 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr data-virtual-spacer="top" aria-hidden="true">
              <td colSpan={colSpan} style={{ height: padTop, padding: 0, border: 'none' }} />
            </tr>
          )}
          {visibleRows.map((row) =>
            row.type === 'group' ? (
              <GroupHeaderRow
                key={row.key}
                name={row.group.name}
                dir={row.group.dir}
                procCount={row.group.pids.length}
                totalMemory={row.group.totalMemory}
                isExpanded={expandedGroups.has(row.group.dir ?? row.group.name)}
                multiSelectEnabled={multiSelectEnabled}
                onToggle={() => onToggle(row.group.dir ?? row.group.name)}
                onKillGroup={() => onKillGroup(row.group.name, row.group.pids)}
              />
            ) : (
              <GroupProcRow
                key={row.key}
                proc={row.proc}
                cpu={cpuMap[row.proc.pid] || 0}
                multiSelectEnabled={multiSelectEnabled}
                isSelected={selectedPids.has(row.proc.pid)}
                isNavFocused={navFocusVisible && row.proc.pid === navFocusPid}
                isKeyboardEntry={!navFocusVisible && row.proc.pid === effectiveNavFocusPid}
                isFocusedGlobal={row.proc.pid === focusedPid}
                onActivate={onActivate}
                onToggleSelect={onToggleSelect}
                onRowKeyDown={onRowKeyDown}
                onKillSingle={onKillSingle}
                onContextMenuRow={onContextMenuRow}
              />
            ),
          )}
          {padBottom > 0 && (
            <tr data-virtual-spacer="bottom" aria-hidden="true">
              <td colSpan={colSpan} style={{ height: padBottom, padding: 0, border: 'none' }} />
            </tr>
          )}
          {flatRows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-3 py-8 text-center text-content-muted">
                无进程
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}