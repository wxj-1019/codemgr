import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const GroupRow = memo(function GroupRow({
  name,
  dir,
  pids,
  totalMemory,
  procs,
  isExpanded,
  cpuMap,
  multiSelectEnabled,
  selectedPids,
  navFocusPid,
  keyboardEntryPid,
  focusedPid,
  onToggle,
  onActivate,
  onToggleSelect,
  onRowKeyDown,
  onKillSingle,
  onKillGroup,
  onContextMenuRow,
}: {
  name: string;
  dir: string | null;
  pids: number[];
  totalMemory: number;
  procs: ProcessInfo[];
  isExpanded: boolean;
  cpuMap: Record<number, number>;
  multiSelectEnabled: boolean;
  selectedPids: Set<number>;
  navFocusPid: number | null;
  keyboardEntryPid: number | null;
  focusedPid: number | null;
  onToggle: () => void;
  onActivate: (pid: number) => void;
  onToggleSelect: (pid: number) => void;
  onRowKeyDown: (e: React.KeyboardEvent, proc: ProcessInfo) => void;
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: () => void;
  onContextMenuRow: (e: React.MouseEvent, proc: ProcessInfo) => void;
}) {
  return (
    <>
      <tr className="border-b border-base-700 bg-base-800/60 hover:bg-base-700">
        {multiSelectEnabled && <td className="px-1 py-2" />}
        <td className="px-2 py-2">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-sm font-medium text-fg-primary"
            title={dir || '未分组进程'}
          >
            <span className="w-4 text-xs text-fg-muted">
              {pids.length > 0 ? (isExpanded ? '▾' : '▸') : ''}
            </span>
            <span className="text-fg-muted">{dir ? <FolderIcon /> : <PackageIcon />}</span>
            <span className="truncate max-w-[260px]">{name}</span>
            <span className="ml-1 text-xs font-normal text-fg-muted">
              ({pids.length} 进程 · 合计 {formatMem(totalMemory)})
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
          <button
            onClick={onKillGroup}
            className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
            title={`结束本组全部 ${pids.length} 个进程`}
          >
            结束本组
          </button>
        </td>
      </tr>
      {isExpanded &&
        procs.map((proc) => {
          const label = labelForProcess(proc.name, proc.cmdline);
          const cpu = cpuMap[proc.pid] || 0;
          return (
            <tr
              key={proc.pid}
              role="row"
              aria-selected={multiSelectEnabled ? selectedPids.has(proc.pid) : undefined}
              tabIndex={proc.pid === navFocusPid || (navFocusPid === null && proc.pid === keyboardEntryPid) ? 0 : -1}
              data-pid={proc.pid}
              data-row-focused={proc.pid === navFocusPid ? 'true' : undefined}
              className={`border-b border-base-700/30 hover:bg-base-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60 ${
                multiSelectEnabled && selectedPids.has(proc.pid) ? 'bg-base-700/50' : ''
              } ${proc.pid === focusedPid ? 'ring-2 ring-inset ring-cyan-400/70' : ''}`}
              onClick={() => onActivate(proc.pid)}
              onKeyDown={(e) => onRowKeyDown(e, proc)}
              onContextMenu={(e) => onContextMenuRow(e, proc)}
            >
              {multiSelectEnabled && (
                <td role="gridcell" className="px-1 py-1">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${proc.name}（PID ${proc.pid}）`}
                    checked={selectedPids.has(proc.pid)}
                    onChange={() => onToggleSelect(proc.pid)}
                    className="accent-accent"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </td>
              )}
              <td className="px-2 py-1">
                <div className="flex items-center gap-1" style={{ paddingLeft: 24 }}>
                  <span className="text-fg-primary truncate max-w-[200px]">
                    {proc.name}
                  </span>
                </div>
              </td>
              <td className="px-2 py-1">
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
        })}
    </>
  );
});

export function ProjectGroupView({ multiSelectEnabled = false, onKillSingle, onKillGroup, onKillTree }: ProjectGroupViewProps) {
  const {
    processes,
    cpuMap,
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
  const onToggle = useCallback((name: string) => toggleGroup(name), [toggleGroup]);
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
  const tableRef = useRef<HTMLTableElement | null>(null);
  const lastDomFocusPidRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (navFocusPid == null) return;
    tableRef.current
      ?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]')
      ?.focus({ preventScroll: true });
  }, [navFocusPid]);

  const onRowKeyDown = useCallback((e: React.KeyboardEvent, proc: ProcessInfo) => {
    const rows = visibleProcsRef.current;
    const index = rows.findIndex((row) => row.pid === proc.pid);
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
      onActivate(proc.pid);
    }
  }, [onActivate]);

  // ── 右键上下文菜单（与 ProcessTable 同构，但项目视图无树信息，结束进程树按 pid>4 放行） ──
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const onContextMenuRow = useCallback((e: React.MouseEvent, proc: ProcessInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, proc });
  }, []);
  const copyText = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => { /* blocked */ });
  }, []);
  const menuItems: ContextMenuItem[] = menu ? [
    { label: '结束进程', danger: true, onSelect: () => onKillSingle(menu.proc.pid, menu.proc.name) },
    ...(menu.proc.pid > 4
      ? [{ label: '结束进程树', danger: true, onSelect: () => onKillTree(menu.proc.pid, menu.proc.name) }]
      : []),
    { label: '复制命令行', dividerBefore: true, onSelect: () => copyText(menu.proc.cmdline), disabled: !menu.proc.cmdline },
    { label: '复制 PID', onSelect: () => copyText(String(menu.proc.pid)) },
  ] : [];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
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
          {groups.map((g) => {
            const groupKey = g.dir ?? g.name; // identity 键：规范化 dir（未分组回退 name）
            const procs = g.pids
              .map((pid) => procByPid.get(pid))
              .filter((x): x is ProcessInfo => !!x);
            return (
              <GroupRow
                key={groupKey}
                name={g.name}
                dir={g.dir}
                pids={g.pids}
                totalMemory={g.totalMemory}
                procs={procs}
                isExpanded={expandedGroups.has(groupKey)}
                cpuMap={cpuMap}
                multiSelectEnabled={multiSelectEnabled}
                selectedPids={selectedPids}
                navFocusPid={navFocusVisible ? navFocusPid : null}
                keyboardEntryPid={effectiveNavFocusPid}
                focusedPid={focusedPid}
                onToggle={() => onToggle(groupKey)}
                onActivate={onActivate}
                onToggleSelect={onToggleSelect}
                onRowKeyDown={onRowKeyDown}
                onKillSingle={onKillSingle}
                onKillGroup={() => onKillGroup(g.name, g.pids)}
                onContextMenuRow={onContextMenuRow}
              />
            );
          })}
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
