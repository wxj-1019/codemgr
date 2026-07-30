import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { labelForProcess } from '../lib/processLabels';
import { groupByProject, type ProjectGroup } from '../lib/projectGroup';
import { sortGroups, sortGroupProcs, type GroupSortKey, type SortDir } from '../lib/groupSort';
import { FolderIcon, PackageIcon, FolderOpen, Terminal, Code } from './icons';
import { ipc } from '../lib/ipc';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { IconButton } from './ui/IconButton';
import { buildProcessMenuItems } from '../lib/processMenu';
import { kindColorOf } from '../lib/kindColors';
import { copyText, openTargetOrNotify } from '../lib/shellClient';

const UNGROUPED = '未分组';
// 未分组组展开时，对组内启发式 cwd 为空的进程按需拉精确 cwd（PEB 直读）。
// 分批限流：每批最多 BATCH_SIZE 个并发 IPC + PEB 行走，批间 BATCH_DELAY_MS 间隔，
// 避免 N 个进程瞬时并发造成 main 进程尖刺。
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 50;

interface ProjectGroupViewProps {
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: (name: string, pids: number[]) => void;
  onKillTree: (pid: number, name: string) => void;
}

function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) : mb.toFixed(1);
}

/** 组头行（子项目 H3 从 GroupRow 拆出，支撑虚拟化逐行渲染）。 */
const GroupHeaderRow = memo(function GroupHeaderRow({
  name,
  dir,
  procCount,
  totalMemory,
  isExpanded,
  onToggle,
  onKillGroup,
}: {
  name: string;
  dir: string | null;
  procCount: number;
  totalMemory: number;
  isExpanded: boolean;
  onToggle: () => void;
  onKillGroup: () => void;
}) {
  return (
    <tr className="border-b border-base-700 bg-base-800/60 hover:bg-base-700">
      <td className="px-2 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-sm font-medium text-fg-primary"
          title={dir || '未分组进程'}
        >
          <span className="w-4 text-xs text-fg-muted">
            {procCount > 0 ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <span className="text-fg-muted">{dir ? <FolderIcon /> : <PackageIcon />}</span>
          <span className="truncate max-w-[260px]">{name}</span>
          <span className="ml-1 text-xs font-normal text-fg-muted">
            ({procCount} 进程 · 合计 {formatMem(totalMemory)})
          </span>
        </button>
      </td>
      <td className="px-2 py-2" />
      <td className="px-2 py-2" />
      <td className="px-2 py-2 text-right font-mono text-fg-secondary">
        {formatMem(totalMemory)}
      </td>
      <td className="px-2 py-2 text-right text-xs text-fg-muted" colSpan={3}>
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

/** 组内进程行（子项目 H3 从 GroupRow 拆出）。 */
const GroupProcRow = memo(function GroupProcRow({
  proc,
  cpu,
  onKillSingle,
  onContextMenuRow,
}: {
  proc: ProcessInfo;
  cpu: number;
  onKillSingle: (pid: number, name: string) => void;
  onContextMenuRow: (e: React.MouseEvent, proc: ProcessInfo) => void;
}) {
  const label = labelForProcess(proc.name, proc.cmdline);
  return (
    <tr
      className="border-b border-base-700/30 hover:bg-base-700"
      onContextMenu={(e) => onContextMenuRow(e, proc)}
    >
      <td className="px-2 py-1" />
      <td className="px-2 py-1">
        <div className="flex items-center gap-1" style={{ paddingLeft: 24 }}>
          <span className="text-fg-primary truncate max-w-[200px]">
            {proc.name}
          </span>
          {label && (
            <span className={`ml-1 rounded px-1 text-[10px] ${kindColorOf(label.kind)}`}>
              {label.label}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1 text-right font-mono text-fg-primary">
        {cpu.toFixed(1)}
      </td>
      <td className="px-2 py-1 text-right font-mono text-fg-primary">
        {formatMem(proc.workingSetBytes)}
      </td>
      <td className="px-2 py-1 text-right font-mono text-fg-secondary">
        {proc.pid}
      </td>
      <td className="px-2 py-1 text-right font-mono text-fg-secondary">
        {proc.threadCount}
      </td>
      <td
        className="px-2 py-1 font-mono text-fg-muted truncate max-w-[300px] text-xs"
        title={proc.cmdline}
      >
        {proc.cmdline || '—'}
      </td>
      <td className="px-2 py-1 text-right">
        <button
          onClick={() => onKillSingle(proc.pid, proc.name)}
          className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
        >
          结束
        </button>
      </td>
    </tr>
  );
});

// 可排序表头列（子项目 H3）：name/cpu/memory/pid，点击切换升降序
const SORTABLE_HEADERS: { key: GroupSortKey; label: string; cls: string }[] = [
  { key: 'name', label: '项目 / 名称', cls: 'px-2 py-2 font-medium' },
  { key: 'cpu', label: 'CPU%', cls: 'w-16 px-2 py-2 font-medium text-right' },
  { key: 'memory', label: '内存/MB', cls: 'w-20 px-2 py-2 font-medium text-right' },
  { key: 'pid', label: 'PID', cls: 'w-16 px-2 py-2 font-medium text-right' },
];

type FlatRow =
  | { type: 'group'; key: string; group: ProjectGroup; procs: ProcessInfo[] }
  | { type: 'proc'; key: string; proc: ProcessInfo };

export function ProjectGroupView({ onKillSingle, onKillGroup, onKillTree }: ProjectGroupViewProps) {
  const {
    processes,
    cpuMap,
    filter,
    expandedGroups,
    toggleGroup,
    preciseCwdByPid,
    setPreciseCwd,
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

  // ── 排序（子项目 H3）：组级 name/memory；组内 name/cpu/memory/pid ──
  const [sort, setSort] = useState<{ key: GroupSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const toggleSort = useCallback((key: GroupSortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }, []);
  const sortedGroups = useMemo(() => sortGroups(groups, sort.key, sort.dir), [groups, sort]);

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

  // ── 扁平化行（子项目 H3）：组头 + 已展开组的排序后进程行，供虚拟化/直接渲染共用 ──
  const flatRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const g of sortedGroups) {
      const groupKey = g.dir ?? g.name; // identity 键：规范化 dir（未分组回退 name）
      const procs = g.pids
        .map((pid) => procByPid.get(pid))
        .filter((x): x is ProcessInfo => !!x);
      const sortedProcs = sortGroupProcs(procs, sort.key, sort.dir, cpuMap);
      out.push({ type: 'group', key: `g:${groupKey}`, group: g, procs: sortedProcs });
      if (expandedGroups.has(groupKey)) {
        for (const p of sortedProcs) {
          out.push({ type: 'proc', key: `p:${groupKey}:${p.pid}`, proc: p });
        }
      }
    }
    return out;
  }, [sortedGroups, procByPid, expandedGroups, sort, cpuMap]);

  // ── 虚拟滚动（子项目 H3，>100 行启用；spacer 方案与 ProcessTable 同构）──
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = flatRows.length > 100;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? flatRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatRows[i]?.type === 'group' ? 37 : 29),
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

  // ── 右键上下文菜单（与 ProcessTable 同构，但项目视图无树信息，结束进程树按 pid>4 放行） ──
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const onContextMenuRow = useCallback((e: React.MouseEvent, proc: ProcessInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, proc });
  }, []);
  // 与 ProcessTable 共用构建器；项目视图无树信息，hasChildren 传 true（按 pid>4 放行）
  const menuItems: ContextMenuItem[] = menu ? buildProcessMenuItems(
    menu.proc,
    { hasChildren: true },
    {
      onOpenTarget: (kind, path) => void openTargetOrNotify(kind, path),
      onCopy: copyText,
      onKillSingle,
      onKillTree,
    },
  ) : [];

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-base-800 text-left text-xs uppercase text-fg-muted">
          <tr>
            {SORTABLE_HEADERS.slice(0, 1).map((h) => (
              <th key={h.key} className={h.cls}>
                <button
                  onClick={() => toggleSort(h.key)}
                  className="hover:text-fg-primary"
                  title={`按${h.label}排序`}
                >
                  {h.label}
                  {sort.key === h.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
            <th className="w-32 px-2 py-2 font-medium">标签</th>
            {SORTABLE_HEADERS.slice(1).map((h) => (
              <th key={h.key} className={h.cls}>
                <button
                  onClick={() => toggleSort(h.key)}
                  className="hover:text-fg-primary"
                  title={`按${h.label}排序`}
                >
                  {h.label}
                  {sort.key === h.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
            <th className="w-14 px-2 py-2 font-medium text-right">线程</th>
            <th className="px-2 py-2 font-medium">命令行</th>
            <th className="w-20 px-2 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr data-virtual-spacer="top" aria-hidden="true">
              <td colSpan={8} style={{ height: padTop, padding: 0, border: 'none' }} />
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
                onToggle={() => onToggle(row.group.dir ?? row.group.name)}
                onKillGroup={() => onKillGroup(row.group.name, row.group.pids)}
              />
            ) : (
              <GroupProcRow
                key={row.key}
                proc={row.proc}
                cpu={cpuMap[row.proc.pid] || 0}
                onKillSingle={onKillSingle}
                onContextMenuRow={onContextMenuRow}
              />
            ),
          )}
          {padBottom > 0 && (
            <tr data-virtual-spacer="bottom" aria-hidden="true">
              <td colSpan={8} style={{ height: padBottom, padding: 0, border: 'none' }} />
            </tr>
          )}
          {flatRows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-fg-muted">
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
