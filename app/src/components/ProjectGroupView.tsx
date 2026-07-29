import { memo, useCallback, useMemo, useState } from 'react';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { labelForProcess } from '../lib/processLabels';
import { groupByProject } from '../lib/projectGroup';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface ProjectGroupViewProps {
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: (name: string, pids: number[]) => void;
  onKillTree: (pid: number, name: string) => void;
}

/** Format working-set bytes as a human-readable MB string. */
function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) : mb.toFixed(1);
}

/** Color classes for each process-label kind (mirrors ProcessTable). */
const KIND_COLORS: Record<string, string> = {
  dev: 'bg-accent/20 text-accent',
  test: 'bg-green-500/20 text-green-400',
  build: 'bg-purple-500/20 text-purple-400',
  container: 'bg-blue-500/20 text-blue-400',
  db: 'bg-amber-500/20 text-amber-400',
  system: 'bg-slate-600/30 text-fg-secondary',
};

const GroupRow = memo(function GroupRow({
  name,
  dir,
  pids,
  totalMemory,
  procs,
  isExpanded,
  cpuMap,
  onToggle,
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
  onToggle: () => void;
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: () => void;
  onContextMenuRow: (e: React.MouseEvent, proc: ProcessInfo) => void;
}) {
  return (
    <>
      <tr className="border-b border-base-700 bg-base-800/60 hover:bg-base-700/40">
        <td className="px-2 py-2">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-sm font-medium text-fg-primary"
            title={dir || '未分组进程'}
          >
            <span className="w-4 text-xs text-fg-muted">
              {pids.length > 0 ? (isExpanded ? '▾' : '▸') : ''}
            </span>
            <span>{dir ? '📁' : '📦'}</span>
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
            className="rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-500"
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
              className="border-b border-base-700/30 hover:bg-base-700/30"
              onContextMenu={(e) => onContextMenuRow(e, proc)}
            >
              <td className="px-2 py-1" />
              <td className="px-2 py-1">
                <div className="flex items-center gap-1" style={{ paddingLeft: 24 }}>
                  <span className="text-fg-primary truncate max-w-[200px]">
                    {proc.name}
                  </span>
                  {label && (
                    <span
                      className={`ml-1 rounded px-1 text-[10px] ${
                        KIND_COLORS[label.kind] || 'bg-slate-600/30 text-fg-secondary'
                      }`}
                    >
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
                  className="rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-500"
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

export function ProjectGroupView({ onKillSingle, onKillGroup, onKillTree }: ProjectGroupViewProps) {
  const {
    processes,
    cpuMap,
    filter,
    expandedGroups,
    toggleGroup,
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

  const groups = useMemo(() => groupByProject(filtered), [filtered]);

  // For inline pid list under each group: map pid -> process.
  const procByPid = useMemo(() => {
    const m = new Map<number, ProcessInfo>();
    for (const p of filtered) m.set(p.pid, p);
    return m;
  }, [filtered]);

  const onToggle = useCallback((name: string) => toggleGroup(name), [toggleGroup]);

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
    <div className="overflow-auto flex-1">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-base-800 text-left text-xs uppercase text-fg-muted">
          <tr>
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
            const procs = g.pids
              .map((pid) => procByPid.get(pid))
              .filter((x): x is ProcessInfo => !!x);
            return (
              <GroupRow
                key={g.name}
                name={g.name}
                dir={g.dir}
                pids={g.pids}
                totalMemory={g.totalMemory}
                procs={procs}
                isExpanded={expandedGroups.has(g.name)}
                cpuMap={cpuMap}
                onToggle={() => onToggle(g.name)}
                onKillSingle={onKillSingle}
                onKillGroup={() => onKillGroup(g.name, g.pids)}
                onContextMenuRow={onContextMenuRow}
              />
            );
          })}
          {groups.length === 0 && (
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
