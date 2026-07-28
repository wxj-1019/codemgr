import { memo, useCallback, useMemo } from 'react';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { labelForProcess } from '../lib/processLabels';

interface ProcessTableProps {
  onKillSingle: (pid: number, name: string) => void;
}

/** A single row in the display tree with its indentation depth. */
interface TreeRow {
  proc: ProcessInfo;
  depth: number;
}

/**
 * Build a depth-first flattened tree from a flat process list.
 *
 * Root nodes are processes whose ppid is 0 or whose parent is not in the list.
 * Children are only recursed into when the parent PID is present in `expandedPids`.
 */
function buildTree(procs: ProcessInfo[], expandedPids: Set<number>): TreeRow[] {
  // Group children by parent PID
  const pidMap = new Map<number, ProcessInfo[]>();
  for (const p of procs) {
    const children = pidMap.get(p.ppid) || [];
    children.push(p);
    pidMap.set(p.ppid, children);
  }

  const result: TreeRow[] = [];

  function walk(pid: number, depth: number) {
    const children = pidMap.get(pid) || [];
    children.sort((a, b) => a.pid - b.pid);
    for (const c of children) {
      // Guard against self-parenting edge case
      if (c.pid === pid) continue;
      result.push({ proc: c, depth });
      if (expandedPids.has(c.pid)) {
        walk(c.pid, depth + 1);
      }
    }
  }

  // Identify roots: ppid === 0 or ppid not present in the list
  const pidSet = new Set(procs.map((p) => p.pid));
  const roots = procs.filter((p) => p.ppid === 0 || !pidSet.has(p.ppid));
  roots.sort((a, b) => a.pid - b.pid);

  for (const r of roots) {
    result.push({ proc: r, depth: 0 });
    if (expandedPids.has(r.pid)) {
      walk(r.pid, 1);
    }
  }

  return result;
}

/** Format working-set bytes as a human-readable MB string. */
function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) : mb.toFixed(1);
}

/** Color classes for each process-label kind. */
const KIND_COLORS: Record<string, string> = {
  dev: 'bg-accent/20 text-accent',
  test: 'bg-green-500/20 text-green-400',
  build: 'bg-purple-500/20 text-purple-400',
  container: 'bg-blue-500/20 text-blue-400',
  db: 'bg-amber-500/20 text-amber-400',
  system: 'bg-slate-600/30 text-fg-secondary',
};

// ---- Memoized row: only re-renders when its own inputs change ----
interface ProcessRowProps {
  proc: ProcessInfo;
  depth: number;
  cpu: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: (pid: number) => void;
  onToggleSelect: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
}

const ProcessRow = memo(function ProcessRow({
  proc, depth, cpu, hasChildren, isExpanded, isSelected,
  onToggleExpand, onToggleSelect, onKill,
}: ProcessRowProps) {
  const label = labelForProcess(proc.name, proc.cmdline);
  const memMB = proc.workingSetBytes / 1048576;
  const memHighlight = memMB > 500;
  const cpuHighlight = cpu > 50;

  return (
    <tr
      key={proc.pid}
      className={`border-b border-base-700/30 hover:bg-base-700/30 cursor-pointer ${
        isSelected ? 'bg-base-700/50' : ''
      } ${memHighlight ? 'bg-yellow-900/10' : ''}`}
      onClick={() => onToggleSelect(proc.pid)}
    >
      <td className="px-1 py-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(proc.pid)}
          className="accent-accent"
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="px-2 py-1">
        <div
          className="flex items-center gap-1"
          style={{ paddingLeft: depth * 16 }}
        >
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(proc.pid);
              }}
              className="w-4 text-xs text-fg-muted hover:text-fg-primary"
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          )}
          {!hasChildren && <span className="w-4" />}
          <span className="text-fg-primary truncate max-w-[200px]">
            {proc.name}
          </span>
          {label && (
            <span
              className={`ml-1 rounded px-1 text-[10px] ${
                KIND_COLORS[label.kind] ||
                'bg-slate-600/30 text-fg-secondary'
              }`}
            >
              {label.label}
            </span>
          )}
        </div>
      </td>
      <td
        className={`px-2 py-1 text-right font-mono ${
          cpuHighlight ? 'text-red-400' : 'text-fg-primary'
        }`}
      >
        {cpu.toFixed(1)}
      </td>
      <td
        className={`px-2 py-1 text-right font-mono ${
          memHighlight ? 'text-amber-400' : 'text-fg-primary'
        }`}
      >
        {formatMem(proc.workingSetBytes)}
      </td>
      <td className="px-2 py-1 text-right font-mono text-fg-secondary">
        {proc.pid}
      </td>
      <td className="px-2 py-1 text-right font-mono text-fg-secondary">
        {proc.threadCount}
      </td>
      <td
        className="px-2 py-1 font-mono text-fg-muted truncate max-w-[400px] text-xs"
        title={proc.cmdline}
      >
        {proc.cmdline || '—'}
      </td>
      <td className="px-2 py-1 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKill(proc.pid, proc.name);
          }}
          className="rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-500"
        >
          结束
        </button>
      </td>
    </tr>
  );
});

export function ProcessTable({ onKillSingle }: ProcessTableProps) {
  const {
    processes,
    cpuMap,
    filter,
    sortKey,
    sortAsc,
    expandedPids,
    selectedPids,
    toggleExpand,
    toggleSelect,
    selectAll,
    clearSelection,
  } = useProcessPanelStore();

  // Stable callbacks so memoized rows don't re-render on every parent render.
  const onToggleExpand = useCallback((pid: number) => toggleExpand(pid), [toggleExpand]);
  const onToggleSelect = useCallback((pid: number) => toggleSelect(pid), [toggleSelect]);

  // ---- Filter ----
  const filtered = useMemo(() => {
    if (!filter.trim()) return processes;
    const q = filter.toLowerCase();
    return processes.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.cmdline.toLowerCase().includes(q) ||
        String(p.pid).includes(q),
    );
  }, [processes, filter]);

  // ---- Sort ----
  const sorted = useMemo(() => {
    const arr = [...filtered];

    if (sortKey === 'name') {
      arr.sort((a, b) =>
        sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
      );
    } else {
      const getVal = (p: ProcessInfo): number => {
        switch (sortKey) {
          case 'cpu':
            return cpuMap[p.pid] || 0;
          case 'memory':
            return p.workingSetBytes;
          case 'pid':
            return p.pid;
        }
      };
      arr.sort((a, b) =>
        sortAsc ? getVal(a) - getVal(b) : getVal(b) - getVal(a),
      );
    }
    return arr;
  }, [filtered, sortKey, sortAsc, cpuMap]);

  // ---- Build display tree from sorted flat list ----
  const rows = useMemo(
    () => buildTree(sorted, expandedPids),
    [sorted, expandedPids],
  );

  // ---- Precompute set of PIDs that have children (O(n) instead of O(n²) per row) ----
  const childrenParentSet = useMemo(() => {
    const s = new Set<number>();
    for (const p of sorted) s.add(p.ppid);
    return s;
  }, [sorted]);

  const allSelected = useMemo(
    () => selectedPids.size > 0 && sorted.every((p) => selectedPids.has(p.pid)),
    [selectedPids, sorted],
  );

  const setSortKey = useProcessPanelStore((s) => s.setSortKey);
  const toggleSort = useProcessPanelStore((s) => s.toggleSort);

  // Clicking a sort header: if it's already the active key, flip direction
  // (this is what makes toggleSort non-dead); otherwise switch columns.
  const onSort = useCallback(
    (key: typeof sortKey) => {
      if (sortKey === key) toggleSort();
      else setSortKey(key);
    },
    [sortKey, setSortKey, toggleSort],
  );

  return (
    <div className="overflow-auto flex-1">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-base-800 text-left text-xs uppercase text-fg-muted">
          <tr>
            <th className="w-8 px-1 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  allSelected
                    ? clearSelection()
                    : selectAll(sorted.map((p) => p.pid))
                }
                className="accent-accent"
              />
            </th>
            <th
              className="px-2 py-2 font-medium cursor-pointer select-none"
              onClick={() => onSort('name')}
            >
              名称 {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              className="w-16 px-2 py-2 font-medium cursor-pointer text-right"
              onClick={() => onSort('cpu')}
            >
              CPU% {sortKey === 'cpu' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              className="w-20 px-2 py-2 font-medium cursor-pointer text-right"
              onClick={() => onSort('memory')}
            >
              内存/MB {sortKey === 'memory' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              className="w-16 px-2 py-2 font-medium cursor-pointer text-right"
              onClick={() => onSort('pid')}
            >
              PID {sortKey === 'pid' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th className="w-14 px-2 py-2 font-medium text-right">线程</th>
            <th className="px-2 py-2 font-medium">命令行</th>
            <th className="w-16 px-2 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ proc, depth }) => (
            <ProcessRow
              key={proc.pid}
              proc={proc}
              depth={depth}
              cpu={cpuMap[proc.pid] || 0}
              hasChildren={childrenParentSet.has(proc.pid)}
              isExpanded={expandedPids.has(proc.pid)}
              isSelected={selectedPids.has(proc.pid)}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
              onKill={onKillSingle}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-fg-muted">
                无进程
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
