import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProcessInfo } from '../../electron/ipc-types';

// 单进程历史曲线滚动窗口长度。进程面板轮询 2s → 60 点 ≈ 120s 窗口。
export const PROC_HIST_LEN = 60;

export interface ProcHistoryPoint {
  ts: number;    // 客户端时间戳（CpuUsage 不带 ts）
  cpu: number;   // cpuPercent
  mem: number;   // workingSetBytes（来自同 tick 的 processes 快照）
}

interface ProcessPanelState {
  processes: ProcessInfo[];
  cpuMap: Record<number, number>;   // pid -> cpuPercent
  procHistory: Record<number, ProcHistoryPoint[]>;  // pid -> 滚动窗口（运行时态，不持久化）
  // 精确 cwd（PEB 直读，按需通道）旁路缓存：pid -> cwd。与 ProcessInfo.cwd（启发式）
  // 区分。分组键优先用此值，缺失回退启发式。一旦填充即冻结，不受 processScan 刷新
  // 影响（防分组抖动）；进程退出随 pidSet 清理一并失效（见 setProcesses prune）。
  preciseCwdByPid: Record<number, string>;
  filter: string;
  sortKey: 'pid' | 'name' | 'cpu' | 'memory';
  sortAsc: boolean;
  viewMode: 'tree' | 'project';     // 树形 / 按项目
  expandedPids: Set<number>;
  expandedGroups: Set<string>;      // 项目视图下展开的组名
  selectedPids: Set<number>;
  loading: boolean;
  error: string | null;
  // 详情侧栏占容器宽度的比例（0-1），驱动 allotment 受控 sizes。持久化，刷新恢复。
  sidebarProportion: number;
  // 轮询间隔（ms），0 = 暂停。持久化，重启后保留。
  pollMs: number;

  setProcesses: (p: ProcessInfo[]) => void;
  setCpuMap: (c: { pid: number; cpuPercent: number }[]) => void;
  appendHistory: (procs: ProcessInfo[], cpus: { pid: number; cpuPercent: number }[], ts: number) => void;
  setFilter: (f: string) => void;
  setSortKey: (k: ProcessPanelState['sortKey']) => void;
  toggleSort: () => void;
  setViewMode: (m: ProcessPanelState['viewMode']) => void;
  toggleViewMode: () => void;
  toggleExpand: (pid: number) => void;
  toggleGroup: (name: string) => void;
  toggleSelect: (pid: number) => void;
  selectAll: (pids?: number[]) => void;
  clearSelection: () => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setSidebarProportion: (p: number) => void;
  setPollMs: (ms: number) => void;
  setPreciseCwd: (pid: number, cwd: string) => void;
  reset: () => void;
}

export const useProcessPanelStore = create<ProcessPanelState>()(
  persist(
    (set) => ({
      processes: [],
      cpuMap: {},
      procHistory: {},
      preciseCwdByPid: {},
      filter: '',
      sortKey: 'pid',
      sortAsc: true,
      viewMode: 'tree',
      expandedPids: new Set<number>(),
      expandedGroups: new Set<string>(),
      selectedPids: new Set<number>(),
      loading: false,
      error: null,
      // 侧栏约占容器 30%；allotment 用比例驱动，窗口 resize 时侧栏按比例缩放
      sidebarProportion: 0.3,
      pollMs: 2000,  // 进程面板默认 2s（与原硬编码 POLL_MS 一致）

      setProcesses: (p) => set((s) => {
        // Prune stale entries: only keep PIDs still present in the new snapshot.
        const pidSet = new Set(p.map((x) => x.pid));
        const selectedPids = new Set([...s.selectedPids].filter((pid) => pidSet.has(pid)));
        const cpuMap: Record<number, number> = {};
        for (const k of Object.keys(s.cpuMap)) {
          const n = Number(k);
          if (pidSet.has(n)) cpuMap[n] = s.cpuMap[n];
        }
        // 同步清理已退出进程的历史曲线（与 cpuMap 同样的 pidSet 过滤）
        const procHistory: Record<number, ProcHistoryPoint[]> = {};
        for (const k of Object.keys(s.procHistory)) {
          const n = Number(k);
          if (pidSet.has(n)) procHistory[n] = s.procHistory[n];
        }
        // 同步清理已退出进程的精确 cwd 缓存（防泄漏；与 cpuMap/procHistory 同 pidSet 过滤）
        const preciseCwdByPid: Record<number, string> = {};
        for (const k of Object.keys(s.preciseCwdByPid)) {
          const n = Number(k);
          if (pidSet.has(n)) preciseCwdByPid[n] = s.preciseCwdByPid[n];
        }
        return { processes: p, error: null, selectedPids, cpuMap, procHistory, preciseCwdByPid };
      }),
      setCpuMap: (c) => set((s) => {
        const m = { ...s.cpuMap };
        for (const x of c) m[x.pid] = x.cpuPercent;
        return { cpuMap: m };
      }),
      appendHistory: (procs, cpus, ts) => set((s) => {
        // 在同一 tick 同时拿到 procs（含 mem）与 cpus（含 cpu）时采点。
        const memByPid = new Map(procs.map((p) => [p.pid, p.workingSetBytes]));
        const next: Record<number, ProcHistoryPoint[]> = {};
        for (const k of Object.keys(s.procHistory)) next[Number(k)] = s.procHistory[Number(k)];
        for (const x of cpus) {
          const arr = [...(next[x.pid] ?? []), { ts, cpu: x.cpuPercent, mem: memByPid.get(x.pid) ?? 0 }];
          if (arr.length > PROC_HIST_LEN) arr.shift();
          next[x.pid] = arr;
        }
        return { procHistory: next };
      }),
      setFilter: (f) => set({ filter: f }),
      setSortKey: (k) => set({ sortKey: k }),
      toggleSort: () => set((s) => ({ sortAsc: !s.sortAsc })),
      setViewMode: (m) => set({ viewMode: m }),
      toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'tree' ? 'project' : 'tree' })),
      toggleExpand: (pid) => set((s) => {
        const next = new Set(s.expandedPids);
        next.has(pid) ? next.delete(pid) : next.add(pid);
        return { expandedPids: next };
      }),
      toggleGroup: (name) => set((s) => {
        const next = new Set(s.expandedGroups);
        next.has(name) ? next.delete(name) : next.add(name);
        return { expandedGroups: next };
      }),
      toggleSelect: (pid) => set((s) => {
        const next = new Set(s.selectedPids);
        next.has(pid) ? next.delete(pid) : next.add(pid);
        return { selectedPids: next };
      }),
      selectAll: (pids) => set((s) => ({
        // If pids given, only select those (e.g. the filtered list); otherwise
        // fall back to selecting every known process (backward compatible).
        selectedPids: new Set(pids ?? s.processes.map((p) => p.pid)),
      })),
      clearSelection: () => set({ selectedPids: new Set() }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set({ error: e }),
      // 钳制到 15%-60%：太窄曲线/命令行看不清，太宽挤掉进程表
      setSidebarProportion: (p) => set({ sidebarProportion: Math.min(0.6, Math.max(0.15, p)) }),
      setPollMs: (ms) => set({ pollMs: ms }),
      setPreciseCwd: (pid, cwd) => set((s) => ({ preciseCwdByPid: { ...s.preciseCwdByPid, [pid]: cwd } })),
      reset: () => set({
        processes: [], cpuMap: {}, procHistory: {}, preciseCwdByPid: {}, filter: '', sortKey: 'pid', sortAsc: true,
        viewMode: 'tree', expandedPids: new Set(), expandedGroups: new Set(),
        selectedPids: new Set(), loading: false, error: null, sidebarProportion: 0.3,
        pollMs: 2000,
      }),
    }),
    {
      name: 'codemgr:process-panel',
      // 只持久化排序/过滤/视图/侧栏比例/刷新间隔偏好；processes/cpuMap/selectedPids 是运行时数据，不存
      partialize: (s) => ({
        sortKey: s.sortKey,
        sortAsc: s.sortAsc,
        filter: s.filter,
        viewMode: s.viewMode,
        sidebarProportion: s.sidebarProportion,
        pollMs: s.pollMs,
      }),
    },
  ),
);
