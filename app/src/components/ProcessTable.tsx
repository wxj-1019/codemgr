import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { usePerfStore } from '../store/perfStore';
import { useFocusStore } from '../store/focusStore';
import { labelForProcess } from '../lib/processLabels';
import { formatBytes } from '../lib/format';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { buildProcessMenuItems } from '../lib/processMenu';
import { filterProcesses } from '../lib/processFilter';
import { kindColorOf } from '../lib/kindColors';
import { copyText, openTargetOrNotify } from '../lib/shellClient';

interface ProcessTableProps {
  multiSelectEnabled?: boolean;
  onKillSingle: (pid: number, name: string) => void;
  onKillTree: (pid: number, name: string) => void;
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
 * 顺序由调用方传入的 procs（已排序）决定；本函数只建立父子关系与 DFS 遍历，不重排。
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

  for (const r of roots) {
    result.push({ proc: r, depth: 0 });
    if (expandedPids.has(r.pid)) {
      walk(r.pid, 1);
    }
  }

  return result;
}

/** Format working-set bytes as a human-readable string (GB/MB 带单位). */
function formatMem(bytes: number): string {
  return formatBytes(bytes);
}

// 虚拟列表：可见行数超过阈值才启用（设计文档 §3.2：>100 进程启用虚拟滚动）。
// 树形行高固定（py-1 + text-sm ≈ 29px），用固定 estimateSize，不做逐行测量。
const VIRTUALIZE_THRESHOLD = 100;
const ROW_HEIGHT = 29;

/** Color classes for each process-label kind（Aurora v1.2：底色降到 14% 透明度，字色不变）。 */
// ---- Memoized row: only re-renders when its own inputs change ----
interface ProcessRowProps {
  proc: ProcessInfo;
  depth: number;
  cpu: number;
  gpu?: { gpuPercent: number; vramBytes: number };  // v2.1 GPU 列（来自 perfStore，可能无）
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  multiSelectEnabled: boolean;
  isFocused: boolean;
  isKeyboardEntry: boolean;
  isFocusedGlobal?: boolean;  // 全局聚焦高亮（C），与多选选中态视觉区分
  onToggleExpand: (pid: number) => void;
  onActivate: (pid: number) => void;
  onToggleSelect: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
  onKillTree: (pid: number, name: string) => void;
  // 右键菜单：转发客户端坐标 + proc，由父组件决定弹什么菜单
  onContextMenuRow: (e: React.MouseEvent, proc: ProcessInfo) => void;
  // 键盘导航：透传 keydown 给父组件处理（不在 memo 内写逻辑，避免击穿 memo）
  onRowKeyDown: (e: React.KeyboardEvent, proc: ProcessInfo) => void;
}

const ProcessRow = memo(function ProcessRow({
  proc, depth, cpu, gpu, hasChildren, isExpanded, isSelected, multiSelectEnabled, isFocused, isKeyboardEntry, isFocusedGlobal,
  onToggleExpand, onActivate, onToggleSelect, onKill, onKillTree, onContextMenuRow, onRowKeyDown,
}: ProcessRowProps) {
  const label = labelForProcess(proc.name, proc.cmdline);
  const memMB = proc.workingSetBytes / 1048576;
  const memHighlight = memMB > 500;
  const cpuHighlight = cpu > 50;
  const gpuHighlight = (gpu?.gpuPercent ?? 0) > 50;

  return (
    <tr
      key={proc.pid}
      role="row"
      aria-selected={multiSelectEnabled ? isSelected : undefined}
      tabIndex={isFocused || isKeyboardEntry ? 0 : -1}
      data-row-focused={isFocused ? 'true' : undefined}
      data-pid={proc.pid}
      className={`border-b border-base-700/30 hover:bg-base-700 cursor-pointer ${
        multiSelectEnabled && isSelected ? 'bg-base-700/50' : ''
      } ${memHighlight ? 'bg-warn/10' : ''} ${
        isFocused ? 'ring-1 ring-inset ring-accent/60 outline-none' : ''
      } ${isFocusedGlobal ? 'ring-2 ring-inset ring-cyan-400/70' : ''}`}
      onClick={() => onActivate(proc.pid)}
      onContextMenu={(e) => onContextMenuRow(e, proc)}
      onKeyDown={(e) => onRowKeyDown(e, proc)}
    >
      {multiSelectEnabled && (
        <td className="px-1 py-1">
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
              className={`ml-1 rounded px-1 text-[10px] ${kindColorOf(label.kind)}`}
            >
              {label.label}
            </span>
          )}
        </div>
      </td>
      <td
        className={`px-2 py-1 text-right font-mono ${
          cpuHighlight ? 'text-danger' : 'text-fg-primary'
        }`}
      >
        {cpu.toFixed(1)}
      </td>
      {/* v2.1 GPU% 列（数据来自 perfStore 轮询；无 GPU 环境显示 —） */}
      <td
        className={`px-2 py-1 text-right font-mono ${
          gpuHighlight ? 'text-danger' : 'text-fg-primary'
        }`}
      >
        {gpu ? gpu.gpuPercent.toFixed(1) : '—'}
      </td>
      <td
        className={`whitespace-nowrap px-2 py-1 text-right font-mono ${
          memHighlight ? 'text-warn' : 'text-fg-primary'
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
          className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
        >
          结束
        </button>
        {hasChildren && proc.pid > 4 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onKillTree(proc.pid, proc.name);
            }}
            className="btn-danger-quiet ml-1 rounded px-1.5 py-0.5 text-[10px]"
            title="结束该进程及其所有子进程"
          >
            树
          </button>
        )}
      </td>
    </tr>
  );
});

export function ProcessTable({ multiSelectEnabled = false, onKillSingle, onKillTree }: ProcessTableProps) {
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
  } = useProcessPanelStore();
  // v2.1 GPU 数据来自 perfStore（独立于 processPanelStore；perf 面板不可见时不更新）
  const gpuPerProcess = usePerfStore((s) => s.current?.gpu.perProcess);
  const gpuAvailable = usePerfStore((s) => s.current?.gpu.available ?? false);
  const gpuMap = useMemo(() => {
    const m = new Map<number, { gpuPercent: number; vramBytes: number }>();
    if (gpuPerProcess) for (const p of gpuPerProcess) m.set(p.pid, { gpuPercent: p.gpuPercent, vramBytes: p.vramBytes });
    return m;
  }, [gpuPerProcess]);

  // Stable callbacks so memoized rows don't re-render on every parent render.
  const onToggleExpand = useCallback((pid: number) => toggleExpand(pid), [toggleExpand]);
  const onToggleSelect = useCallback((pid: number) => toggleSelect(pid), [toggleSelect]);

  // 全局聚焦（C）：focusedPid 来自任意面板点击，驱动行高亮 + 滚动定位。
  const focusedPid = useFocusStore((s) => s.focusedPid);
  const focus = useFocusStore((s) => s.focus);
  // 行激活始终设全局聚焦；仅多选模式同时切换选择。
  const onRowActivate = useCallback((pid: number) => {
    if (multiSelectEnabled) toggleSelect(pid);
    focus(pid, 'process');
  }, [multiSelectEnabled, toggleSelect, focus]);

  // ---- Filter（谓词抽 lib/processFilter，与 ProcessPanel 导出入口共用）----
  const filtered = useMemo(() => filterProcesses(processes, filter), [processes, filter]);

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
          case 'gpu':
            return gpuMap.get(p.pid)?.gpuPercent ?? 0;
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
  }, [filtered, sortKey, sortAsc, cpuMap, gpuMap]);

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
    () => rows.length > 0 && rows.every((r) => selectedPids.has(r.proc.pid)),
    [selectedPids, rows],
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

  // 排序表头键盘触发：Enter/Space 触发 onSort（让表头键盘可达，不依赖鼠标）
  const onSortKeyDown = useCallback(
    (e: React.KeyboardEvent, key: typeof sortKey) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSort(key);
      }
    },
    [onSort],
  );

  // ── 右键上下文菜单 ──
  // 稳定 callback：只记录坐标+proc，items 在渲染时按 proc 动态构造。
  // 用 useCallback 避免每次渲染生成新函数引用导致所有 memoized 行重渲染。
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const onContextMenuRow = useCallback((e: React.MouseEvent, proc: ProcessInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, proc });
  }, []);

  // ── 键盘导航（纯导航模型：焦点框与 selectedPids 分离）──
  // 焦点用 pid 锚定（非 index）：排序/折叠/过滤后行序会变，按 pid 定位才稳定。
  // 用 ref 持有最新 rows，让 onRowKeyDown 引用稳定（不击穿 memo）。
  const [navFocusPid, setNavFocusPid] = useState<number | null>(null);
  const navFocusVisible = navFocusPid !== null && rows.some((row) => row.proc.pid === navFocusPid);
  const effectiveNavFocusPid = navFocusVisible ? navFocusPid : (rows[0]?.proc.pid ?? null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const lastDomFocusPidRef = useRef<number | null>(null);

  // ── 虚拟列表（>VIRTUALIZE_THRESHOLD 行时启用；≤阈值保持全量渲染，避免回归）──
  // hook 无条件调用（React 规则），仅渲染分支按 shouldVirtualize 切换。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = rows.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const pendingFallbackFocusPidRef = useRef<number | null>(null);

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
      const idx = rowsRef.current.findIndex((row) => row.proc.pid === effectiveNavFocusPid);
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

  // 焦点变化时滚动：虚拟化用 virtualizer.scrollToIndex（焦点行可能未渲染，
  // scrollIntoView 找不到 DOM）；非虚拟化维持原 scrollIntoView。
  // 只挂在 navFocusPid 上——挂在 virtualItems 上会把用户滚动"拉回"焦点行。
  useEffect(() => {
    if (navFocusPid == null) return;
    if (shouldVirtualize) {
      const idx = rowsRef.current.findIndex((r) => r.proc.pid === navFocusPid);
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
      // jsdom 无 scrollIntoView，加 typeof 防御（真实 Electron 环境有该方法）。
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [navFocusPid, shouldVirtualize, virtualizer]);

  // 焦点行 DOM 挂载后 focus（roving tabindex 的标准配套）。
  // 用 data 属性 + querySelector 定位，避免给 memo 的 ProcessRow 加 forwardRef。
  // 依赖 virtualItems：虚拟化下 scrollToIndex 后焦点行才渲染，渲染后本 effect 重跑补上 focus。
  // preventScroll：滚动由上面的 effect 负责，避免 focus 原生滚动与 virtualizer 互相打架。
  useEffect(() => {
    if (navFocusPid == null) return;
    const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
    el?.focus({ preventScroll: true });
  }, [navFocusPid, virtualItems]);

  // 全局聚焦（C）：focusedPid 变化时滚动到该行（外部面板点击触发）。
  // 与 navFocusPid（键盘焦点）滚动分开：全局聚焦来自端口/GPU/快照面板。
  useEffect(() => {
    if (focusedPid == null) return;
    const idx = rowsRef.current.findIndex((r) => r.proc.pid === focusedPid);
    if (idx === -1) return;  // 进程不在当前列表（已退出/被过滤）：不滚动
    if (shouldVirtualize) {
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>(`[data-pid="${focusedPid}"]`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedPid, shouldVirtualize, virtualizer]);

  const onRowKeyDown = useCallback((e: React.KeyboardEvent, proc: ProcessInfo) => {
    const cur = rowsRef.current;
    if (cur.length === 0) return;
    const idx = cur.findIndex((r) => r.proc.pid === proc.pid);
    if (idx === -1) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < cur.length - 1) setNavFocusPid(cur[idx + 1].proc.pid);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) setNavFocusPid(cur[idx - 1].proc.pid);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowActivate(proc.pid);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setNavFocusPid(cur[0].proc.pid);
    } else if (e.key === 'End') {
      e.preventDefault();
      setNavFocusPid(cur[cur.length - 1].proc.pid);
    }
  }, [onRowActivate]);

  // 菜单项由共享构建器生成（与 ProjectGroupView 一致）：打开三项 → 复制三项 → kill 沉底。
  // kill 操作复用与内联按钮一致的回调（触发 ConfirmDialog）。
  const menuItems: ContextMenuItem[] = menu ? buildProcessMenuItems(
    menu.proc,
    { hasChildren: childrenParentSet.has(menu.proc.pid) },
    {
      onOpenTarget: (kind, path) => void openTargetOrNotify(kind, path),
      onCopy: copyText,
      onKillSingle,
      onKillTree,
    },
  ) : [];

  // 虚拟化渲染窗口：上下用等高占位 <tr> 撑出总高度（保持 <table> 布局/列宽对齐，
  // 不切换为绝对定位）。行高固定，无需逐行测量。
  const padTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const padBottom = shouldVirtualize && virtualItems.length > 0
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;
  const renderRow = ({ proc, depth }: TreeRow) => (
    <ProcessRow
      key={proc.pid}
      proc={proc}
      depth={depth}
      cpu={cpuMap[proc.pid] || 0}
      gpu={gpuAvailable ? gpuMap.get(proc.pid) : undefined}
      hasChildren={childrenParentSet.has(proc.pid)}
      isExpanded={expandedPids.has(proc.pid)}
      isSelected={selectedPids.has(proc.pid)}
      multiSelectEnabled={multiSelectEnabled}
      isFocused={navFocusVisible && proc.pid === navFocusPid}
      isKeyboardEntry={proc.pid === effectiveNavFocusPid}
      isFocusedGlobal={proc.pid === focusedPid}
      onToggleExpand={onToggleExpand}
      onActivate={onRowActivate}
      onToggleSelect={onToggleSelect}
      onKill={onKillSingle}
      onKillTree={onKillTree}
      onContextMenuRow={onContextMenuRow}
      onRowKeyDown={onRowKeyDown}
    />
  );

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <table
        ref={tableRef}
        role="grid"
        className="w-full text-sm"
        onFocusCapture={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-pid]');
          if (row) lastDomFocusPidRef.current = Number(row.dataset.pid);
        }}
      >
        <thead className="sticky top-0 z-10 bg-base-800 text-left text-xs text-fg-muted">
          <tr>
            {multiSelectEnabled && (
              <th className="w-8 px-1 py-2">
                <input
                  type="checkbox"
                  aria-label="全选可见行"
                  checked={allSelected}
                  onChange={() => {
                    const visiblePids = rows.map((r) => r.proc.pid);
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
            <th
              tabIndex={0}
              role="button"
              aria-sort={sortKey === 'name' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
              className="px-2 py-2 font-medium cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/60"
              onClick={() => onSort('name')}
              onKeyDown={(e) => onSortKeyDown(e, 'name')}
            >
              名称 {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              tabIndex={0}
              role="button"
              aria-sort={sortKey === 'cpu' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
              className="w-16 px-2 py-2 font-medium cursor-pointer text-right focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/60"
              onClick={() => onSort('cpu')}
              onKeyDown={(e) => onSortKeyDown(e, 'cpu')}
            >
              CPU% {sortKey === 'cpu' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            {/* v2.1 GPU% 列头（无 GPU 环境仍显示，数据为 —） */}
            <th
              tabIndex={0}
              role="button"
              aria-sort={sortKey === 'gpu' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
              className="w-16 px-2 py-2 font-medium cursor-pointer text-right focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/60"
              onClick={() => onSort('gpu')}
              onKeyDown={(e) => onSortKeyDown(e, 'gpu')}
              title="数据来自性能面板轮询"
            >
              GPU% {sortKey === 'gpu' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              tabIndex={0}
              role="button"
              aria-sort={sortKey === 'memory' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
              className="w-24 px-2 py-2 font-medium cursor-pointer text-right focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/60"
              onClick={() => onSort('memory')}
              onKeyDown={(e) => onSortKeyDown(e, 'memory')}
            >
              内存 {sortKey === 'memory' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th
              tabIndex={0}
              role="button"
              aria-sort={sortKey === 'pid' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
              className="w-16 px-2 py-2 font-medium cursor-pointer text-right focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/60"
              onClick={() => onSort('pid')}
              onKeyDown={(e) => onSortKeyDown(e, 'pid')}
            >
              PID {sortKey === 'pid' ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            <th className="w-14 px-2 py-2 font-medium text-right">线程</th>
            <th className="px-2 py-2 font-medium">命令行</th>
            <th className="w-16 px-2 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {shouldVirtualize ? (
            <>
              {padTop > 0 && (
                <tr aria-hidden="true" data-virtual-spacer="top">
                  <td colSpan={multiSelectEnabled ? 9 : 8} style={{ height: padTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualItems.map((vi) => renderRow(rows[vi.index]))}
              {padBottom > 0 && (
                <tr aria-hidden="true" data-virtual-spacer="bottom">
                  <td colSpan={multiSelectEnabled ? 9 : 8} style={{ height: padBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </>
          ) : (
            rows.map(renderRow)
          )}
          {rows.length === 0 && (
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
