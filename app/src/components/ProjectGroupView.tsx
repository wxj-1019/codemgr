import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useFocusStore } from '../store/focusStore';
import { labelForProcess } from '../lib/processLabels';
import { groupByProject } from '../lib/projectGroup';
import { FolderIcon, PackageIcon } from './icons';
import { ipc } from '../lib/ipc';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

const UNGROUPED = '未分组';
// 未分组组展开时，对组内启发式 cwd 为空的进程按需拉精确 cwd（PEB 直读）。
// 分批限流：每批最多 BATCH_SIZE 个并发 IPC + PEB 行走，批间 BATCH_DELAY_MS 间隔，
// 避免 N 个进程瞬时并发造成 main 进程尖刺。
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 50;

// 虚拟列表（UX-13，设计文档 §3.2：>100 进程启用虚拟滚动）。
// 组头行与进程行行高固定（单行，无换行），用分类型固定 estimateSize，不做逐行测量。
const VIRTUALIZE_THRESHOLD = 100;
const GROUP_ROW_HEIGHT = 36;   // h-9
const ROW_HEIGHT = 29;         // 与 ProcessTable 一致

interface ProjectGroupViewProps {
  multiSelectEnabled?: boolean;
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: (name: string, pids: number[]) => void;
  onKillTree: (pid: number, name: string) => void;
}

/** Format working-set bytes as a human-readable MB string. */
function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) : mb.toFixed(1);
}

/** Color classes for each process-label kind（Aurora v1.2：底色降到 14% 透明度，字色不变）。 */
const KIND_COLORS: Record<string, string> = {
  dev: 'bg-accent/[0.14] text-accent',
  test: 'bg-green-500/[0.14] text-green-400',
  build: 'bg-purple-500/[0.14] text-purple-400',
  container: 'bg-blue-500/[0.14] text-blue-400',
  db: 'bg-amber-500/[0.14] text-amber-400',
  system: 'bg-slate-600/[0.14] text-fg-secondary',
  ai: 'bg-fuchsia-500/[0.14] text-fuchsia-400',
  'ai-ide': 'bg-violet-500/[0.14] text-violet-400',
};

/**
 * 扁平行模型（UX-13）：组头行 + 展开的进程行拍平成一维数组，
 * 供 useVirtualizer 索引。行组件只收原始类型 props（+ 稳定回调），
 * 动态值（cpu/选中态）在行组件内用 store selector 订阅——
 * 修复原 GroupRow 的 memo 击穿（整个 cpuMap + 每轮新 Set 传入）。
 */
type FlatRow =
  | { type: 'group'; key: string; name: string; dir: string | null; count: number; totalMemory: number; isExpanded: boolean }
  | { type: 'proc'; key: string; pid: number; name: string; cmdline: string; mem: number; threadCount: number; groupKey: string };

/** 组头行：primitive props + 稳定回调，memo 有效。 */
const GroupHeaderRow = memo(function GroupHeaderRow({
  name, dir, count, totalMemory, isExpanded, groupKey,
  onToggleGroup, onKillGroupName,
}: {
  name: string;
  dir: string | null;
  count: number;
  totalMemory: number;
  isExpanded: boolean;
  groupKey: string;
  onToggleGroup: (key: string) => void;
  onKillGroupName: (key: string) => void;
}) {
  return (
    <tr className="h-9 border-b border-base-700 bg-base-800/60 hover:bg-base-700">
      <td className="px-1 py-0" />
      <td className="px-2 py-0">
        <button
          onClick={() => onToggleGroup(groupKey)}
          className="flex items-center gap-1 text-sm font-medium text-fg-primary"
          title={dir || '未分组进程'}
        >
          <span className="w-4 text-xs text-fg-muted">
            {count > 0 ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <span className="text-fg-muted">{dir ? <FolderIcon /> : <PackageIcon />}</span>
          <span className="truncate max-w-[260px]">{name}</span>
          <span className="ml-1 text-xs font-normal text-fg-muted">
            ({count} 进程 · 合计 {formatMem(totalMemory)})
          </span>
        </button>
      </td>
      <td className="px-2 py-0" />
      <td className="px-2 py-0" />
      <td className="px-2 py-0 text-right font-mono text-fg-secondary">
        {formatMem(totalMemory)}
      </td>
      <td className="px-2 py-0 text-right text-xs text-fg-muted" colSpan={3}>
        {dir || '—'}
      </td>
      <td className="px-2 py-0 text-right">
        <button
          onClick={() => onKillGroupName(groupKey)}
          className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
          title={`结束本组全部 ${count} 个进程`}
        >
          结束本组
        </button>
      </td>
    </tr>
  );
});

/** 进程行：primitive props + 稳定回调；cpu/选中态走 store selector（memo 不被击穿）。 */
const ProcRow = memo(function ProcRow({
  pid, name, cmdline, mem, threadCount,
  multiSelectEnabled, navFocused, isKeyboardEntry, isFocused,
  onActivate, onToggleSelect, onRowKeyDown, onKillSingle, onContextMenuRow,
}: {
  pid: number;
  name: string;
  cmdline: string;
  mem: number;
  threadCount: number;
  multiSelectEnabled: boolean;
  navFocused: boolean;
  isKeyboardEntry: boolean;
  isFocused: boolean;
  onActivate: (pid: number) => void;
  onToggleSelect: (pid: number) => void;
  onRowKeyDown: (e: React.KeyboardEvent, pid: number) => void;
  onKillSingle: (pid: number, name: string) => void;
  onContextMenuRow: (e: React.MouseEvent, pid: number, name: string) => void;
}) {
  // 动态值按行订阅（zustand selector 粒度）：只在本行 cpu/选中态变化时重渲染
  const cpu = useProcessPanelStore((s) => s.cpuMap[pid] ?? 0);
  const isSelected = useProcessPanelStore((s) => s.selectedPids.has(pid));
  const label = labelForProcess(name, cmdline);

  return (
    <tr
      role="row"
      aria-selected={multiSelectEnabled ? isSelected : undefined}
      tabIndex={navFocused || (!navFocused && isKeyboardEntry) ? 0 : -1}
      data-pid={pid}
      data-row-focused={navFocused ? 'true' : undefined}
      className={`h-[29px] border-b border-base-700/30 hover:bg-base-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60 ${
        multiSelectEnabled && isSelected ? 'bg-base-700/50' : ''
      } ${isFocused ? 'ring-2 ring-inset ring-cyan-400/70' : ''}`}
      onClick={() => onActivate(pid)}
      onKeyDown={(e) => onRowKeyDown(e, pid)}
      onContextMenu={(e) => onContextMenuRow(e, pid, name)}
    >
      {multiSelectEnabled && (
        <td role="gridcell" className="px-1 py-0">
          <input
            type="checkbox"
            aria-label={`选择 ${name}（PID ${pid}）`}
            checked={isSelected}
            onChange={() => onToggleSelect(pid)}
            className="accent-accent"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </td>
      )}
      <td className="px-2 py-0">
        <div className="flex items-center gap-1" style={{ paddingLeft: 24 }}>
          <span className="text-fg-primary truncate max-w-[200px]">
            {name}
          </span>
        </div>
      </td>
      <td className="px-2 py-0">
        {label && (
          <span
            className={`rounded px-1 text-[10px] ${
              KIND_COLORS[label.kind] || 'bg-slate-600/[0.14] text-fg-secondary'
            }`}
          >
            {label.label}
          </span>
        )}
      </td>
      <td className="px-2 py-0 text-right font-mono text-fg-primary">
        {cpu.toFixed(1)}
      </td>
      <td className="px-2 py-0 text-right font-mono text-fg-primary">
        {formatMem(mem)}
      </td>
      <td className="px-2 py-0 text-right font-mono text-fg-secondary">
        {pid}
      </td>
      <td className="px-2 py-0 text-right font-mono text-fg-secondary">
        {threadCount}
      </td>
      <td
        className="px-2 py-0 font-mono text-fg-muted truncate max-w-[300px] text-xs"
        title={cmdline}
      >
        {cmdline || '—'}
      </td>
      <td className="px-2 py-0 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKillSingle(pid, name);
          }}
          className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
        >
          结束
        </button>
      </td>
    </tr>
  );
});

export function ProjectGroupView({ multiSelectEnabled = false, onKillSingle, onKillGroup, onKillTree }: ProjectGroupViewProps) {
  const {
    processes,
    selectedPids,
    toggleSelect,
    selectAll,
    filter,
    expandedGroups,
    toggleGroup,
    preciseCwdByPid,
    setPreciseCwd,
  } = useProcessPanelStore();

  // Apply the same filter as the tree view (name/cmdline/pid).
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

  // 扁平行（UX-13）：组头 + 展开的进程行。只在分组/展开/进程集合变化时重建，
  // 每轮轮询的 cpu/选中态变化由行内 store selector 承接，不重建整表。
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const g of groups) {
      const groupKey = g.dir ?? g.name;
      rows.push({
        type: 'group', key: groupKey, name: g.name, dir: g.dir,
        count: g.pids.length, totalMemory: g.totalMemory, isExpanded: expandedGroups.has(groupKey),
      });
      if (expandedGroups.has(groupKey)) {
        for (const pid of g.pids) {
          const p = procByPid.get(pid);
          if (!p) continue;
          rows.push({
            type: 'proc', key: `${groupKey}:${pid}`,
            pid: p.pid, name: p.name, cmdline: p.cmdline, mem: p.workingSetBytes,
            threadCount: p.threadCount, groupKey,
          });
        }
      }
    }
    return rows;
  }, [groups, expandedGroups, procByPid]);

  const visibleProcs = useMemo(
    () => groups.flatMap((g) => {
      const groupKey = g.dir ?? g.name;
      if (!expandedGroups.has(groupKey)) return [];
      return g.pids
        .map((pid) => procByPid.get(pid))
        .filter((proc): proc is ProcessInfo => !!proc);
    }),
    [groups, expandedGroups, procByPid],
  );

  const focusedPid = useFocusStore((s) => s.focusedPid);
  const focus = useFocusStore((s) => s.focus);

  // ── 稳定回调（memo 行的 props 保持引用稳定，避免每轮轮询击穿） ──
  const onToggleGroup = useCallback((key: string) => toggleGroup(key), [toggleGroup]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const onKillGroupName = useCallback((key: string) => {
    const g = groupsRef.current.find((gr) => (gr.dir ?? gr.name) === key);
    if (g) onKillGroup(g.name, g.pids);
  }, [onKillGroup]);
  const onActivate = useCallback((pid: number) => {
    if (multiSelectEnabled) toggleSelect(pid);
    focus(pid, 'process');
  }, [multiSelectEnabled, toggleSelect, focus]);
  const onToggleSelect = useCallback((pid: number) => toggleSelect(pid), [toggleSelect]);
  const procByPidRef = useRef(procByPid);
  procByPidRef.current = procByPid;
  const onContextMenuRow = useCallback((e: React.MouseEvent, pid: number, name: string) => {
    e.preventDefault();
    const proc = procByPidRef.current.get(pid);
    if (proc) setMenu({ x: e.clientX, y: e.clientY, proc });
  }, []);
  const onKillSingleCb = useCallback((pid: number, name: string) => onKillSingle(pid, name), [onKillSingle]);
  const onKillTreeCb = useCallback((pid: number, name: string) => onKillTree(pid, name), [onKillTree]);

  // ── 键盘导航（虚拟化感知：焦点行可能未渲染，走 scrollToIndex 兜底） ──
  const [navFocusPid, setNavFocusPid] = useState<number | null>(null);
  const navFocusVisible = navFocusPid !== null && visibleProcs.some((proc) => proc.pid === navFocusPid);
  const effectiveNavFocusPid = navFocusVisible ? navFocusPid : (visibleProcs[0]?.pid ?? null);
  const visibleProcsRef = useRef(visibleProcs);
  visibleProcsRef.current = visibleProcs;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const lastDomFocusPidRef = useRef<number | null>(null);

  // ── 虚拟列表（>VIRTUALIZE_THRESHOLD 行时启用；≤阈值保持全量渲染，避免回归） ──
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = flatRows.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatRows[i]?.type === 'group' ? GROUP_ROW_HEIGHT : ROW_HEIGHT),
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const flatRowsRef = useRef(flatRows);
  flatRowsRef.current = flatRows;
  const pendingFallbackFocusPidRef = useRef<number | null>(null);
  // 扁平行中某个 pid 的行索引（scrollToIndex 用）
  const indexOfPid = (pid: number) =>
    flatRowsRef.current.findIndex((r) => r.type === 'proc' && r.pid === pid);

  useEffect(() => {
    const previousPid = lastDomFocusPidRef.current;
    if (previousPid == null || navFocusVisible || effectiveNavFocusPid == null) return;
    const active = document.activeElement;
    if (active !== document.body && !tableRef.current?.contains(active)) return;
    const fallbackRow = tableRef.current
      ?.querySelector<HTMLTableRowElement>(`[data-pid="${effectiveNavFocusPid}"]`);
    if (fallbackRow) {
      fallbackRow.focus({ preventScroll: true });
    } else if (shouldVirtualize) {
      pendingFallbackFocusPidRef.current = effectiveNavFocusPid;
      const idx = indexOfPid(effectiveNavFocusPid);
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' });
    }
    lastDomFocusPidRef.current = effectiveNavFocusPid;
  }, [effectiveNavFocusPid, navFocusVisible, shouldVirtualize, virtualizer]);

  useEffect(() => {
    const pendingPid = pendingFallbackFocusPidRef.current;
    if (pendingPid == null) return;
    const active = document.activeElement;
    if (active !== document.body && !tableRef.current?.contains(active)) {
      pendingFallbackFocusPidRef.current = null;
      return;
    }
    const fallbackRow = tableRef.current
      ?.querySelector<HTMLTableRowElement>(`[data-pid="${pendingPid}"]`);
    if (!fallbackRow) return;
    fallbackRow.focus({ preventScroll: true });
    pendingFallbackFocusPidRef.current = null;
  }, [virtualItems]);

  // 焦点变化时滚动：虚拟化用 scrollToIndex（焦点行可能未渲染）；非虚拟化维持 scrollIntoView。
  useEffect(() => {
    if (navFocusPid == null) return;
    if (shouldVirtualize) {
      const idx = indexOfPid(navFocusPid);
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
      // jsdom 无 scrollIntoView，加 typeof 防御（真实 Electron 环境有该方法）。
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [navFocusPid, shouldVirtualize, virtualizer]);

  // 焦点行 DOM 挂载后 focus（roving tabindex 的标准配套）。依赖 virtualItems：
  // 虚拟化下 scrollToIndex 后焦点行才渲染，渲染后本 effect 重跑补上 focus。
  useEffect(() => {
    if (navFocusPid == null) return;
    const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
    el?.focus({ preventScroll: true });
  }, [navFocusPid, virtualItems]);

  // 全局聚焦（C）：focusedPid 变化时滚动到该行（外部面板点击触发）。
  useEffect(() => {
    if (focusedPid == null) return;
    const idx = indexOfPid(focusedPid);
    if (idx === -1) return;  // 进程不在当前列表（已退出/被过滤）：不滚动
    if (shouldVirtualize) {
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>(`[data-pid="${focusedPid}"]`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedPid, shouldVirtualize, virtualizer]);

  const onRowKeyDown = useCallback((e: React.KeyboardEvent, pid: number) => {
    const rows = visibleProcsRef.current;
    const index = rows.findIndex((row) => row.pid === pid);
    if (index === -1) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index < rows.length - 1) setNavFocusPid(rows[index + 1].pid);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) setNavFocusPid(rows[index - 1].pid);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (rows.length > 0) setNavFocusPid(rows[0].pid);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (rows.length > 0) setNavFocusPid(rows[rows.length - 1].pid);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate(pid);
    }
  }, [onActivate]);

  // ── 右键上下文菜单（与 ProcessTable 同构，但项目视图无树信息，结束进程树按 pid>4 放行） ──
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const copyText = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => { /* blocked */ });
  }, []);
  const menuItems: ContextMenuItem[] = menu ? [
    { label: '结束进程', danger: true, onSelect: () => onKillSingleCb(menu.proc.pid, menu.proc.name) },
    ...(menu.proc.pid > 4
      ? [{ label: '结束进程树', danger: true, onSelect: () => onKillTreeCb(menu.proc.pid, menu.proc.name) }]
      : []),
    { label: '复制命令行', dividerBefore: true, onSelect: () => copyText(menu.proc.cmdline), disabled: !menu.proc.cmdline },
    { label: '复制 PID', onSelect: () => copyText(String(menu.proc.pid)) },
  ] : [];

  // 虚拟化渲染窗口：上下用等高占位 <tr> 撑出总高度（保持 <table> 布局/列宽对齐，
  // 不切换为绝对定位）。行高按类型固定，无需逐行测量。
  const padTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const padBottom = shouldVirtualize && virtualItems.length > 0
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;
  const renderRows = shouldVirtualize ? virtualItems.map((vi) => flatRows[vi.index]) : flatRows;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <table
        ref={tableRef}
        className="w-full text-sm"
        onFocusCapture={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-pid]');
          if (row) lastDomFocusPidRef.current = Number(row.dataset.pid);
        }}
      >
        <thead className="sticky top-0 z-10 bg-base-800 text-left text-xs uppercase text-fg-muted">
          <tr>
            {multiSelectEnabled && (
              <th className="w-8 px-1 py-2">
                <input
                  type="checkbox"
                  aria-label="全选可见行"
                  checked={(() => {
                    const visiblePids = groups
                      .filter((g) => expandedGroups.has(g.dir ?? g.name))
                      .flatMap((g) => g.pids);
                    return visiblePids.length > 0 && visiblePids.every((pid) => selectedPids.has(pid));
                  })()}
                  onChange={() => {
                    const visiblePids = groups
                      .filter((g) => expandedGroups.has(g.dir ?? g.name))
                      .flatMap((g) => g.pids);
                    const allSelected = visiblePids.length > 0 && visiblePids.every((pid) => selectedPids.has(pid));
                    if (allSelected) {
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
            <th className="px-2 py-2 font-medium">项目 / 名称</th>
            <th className="w-32 px-2 py-2 font-medium">标签</th>
            <th className="w-16 px-2 py-2 font-medium text-right">CPU%</th>
            <th className="w-20 px-2 py-2 font-medium text-right">内存/MB</th>
            <th className="w-16 px-2 py-2 font-medium text-right">PID</th>
            <th className="w-14 px-2 py-2 font-medium text-right">线程</th>
            <th className="px-2 py-2 font-medium">命令行</th>
            <th className="w-20 px-2 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }} />}
          {renderRows.map((row) => (
            row.type === 'group' ? (
              <GroupHeaderRow
                key={row.key}
                name={row.name}
                dir={row.dir}
                count={row.count}
                totalMemory={row.totalMemory}
                isExpanded={row.isExpanded}
                groupKey={row.key}
                onToggleGroup={onToggleGroup}
                onKillGroupName={onKillGroupName}
              />
            ) : (
              <ProcRow
                key={row.key}
                pid={row.pid}
                name={row.name}
                cmdline={row.cmdline}
                mem={row.mem}
                threadCount={row.threadCount}
                multiSelectEnabled={multiSelectEnabled}
                navFocused={navFocusVisible && row.pid === navFocusPid}
                isKeyboardEntry={row.pid === effectiveNavFocusPid}
                isFocused={row.pid === focusedPid}
                onActivate={onActivate}
                onToggleSelect={onToggleSelect}
                onRowKeyDown={onRowKeyDown}
                onKillSingle={onKillSingleCb}
                onContextMenuRow={onContextMenuRow}
              />
            )
          ))}
          {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }} />}
          {groups.length === 0 && (
            <tr>
              <td colSpan={multiSelectEnabled ? 9 : 8} className="px-3 py-8 text-center text-fg-muted">
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
