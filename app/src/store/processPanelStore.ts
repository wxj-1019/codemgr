import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProcessInfo } from '../../electron/ipc-types';

interface ProcessPanelState {
  processes: ProcessInfo[];
  cpuMap: Record<number, number>;   // pid -> cpuPercent
  filter: string;
  sortKey: 'pid' | 'name' | 'cpu' | 'memory';
  sortAsc: boolean;
  viewMode: 'tree' | 'project';     // 树形 / 按项目
  expandedPids: Set<number>;
  expandedGroups: Set<string>;      // 项目视图下展开的组名
  selectedPids: Set<number>;
  loading: boolean;
  error: string | null;

  setProcesses: (p: ProcessInfo[]) => void;
  setCpuMap: (c: { pid: number; cpuPercent: number }[]) => void;
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
  reset: () => void;
}

export const useProcessPanelStore = create<ProcessPanelState>()(
  persist(
    (set) => ({
      processes: [],
      cpuMap: {},
      filter: '',
      sortKey: 'pid',
      sortAsc: true,
      viewMode: 'tree',
      expandedPids: new Set<number>(),
      expandedGroups: new Set<string>(),
      selectedPids: new Set<number>(),
      loading: false,
      error: null,

      setProcesses: (p) => set((s) => {
        // Prune stale entries: only keep PIDs still present in the new snapshot.
        const pidSet = new Set(p.map((x) => x.pid));
        const selectedPids = new Set([...s.selectedPids].filter((pid) => pidSet.has(pid)));
        const cpuMap: Record<number, number> = {};
        for (const k of Object.keys(s.cpuMap)) {
          const n = Number(k);
          if (pidSet.has(n)) cpuMap[n] = s.cpuMap[n];
        }
        return { processes: p, error: null, selectedPids, cpuMap };
      }),
      setCpuMap: (c) => set((s) => {
        const m = { ...s.cpuMap };
        for (const x of c) m[x.pid] = x.cpuPercent;
        return { cpuMap: m };
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
      reset: () => set({
        processes: [], cpuMap: {}, filter: '', sortKey: 'pid', sortAsc: true,
        viewMode: 'tree', expandedPids: new Set(), expandedGroups: new Set(),
        selectedPids: new Set(), loading: false, error: null,
      }),
    }),
    {
      name: 'codemgr:process-panel',
      // 只持久化排序/过滤/视图偏好；processes/cpuMap/selectedPids 是运行时数据，不存
      partialize: (s) => ({
        sortKey: s.sortKey,
        sortAsc: s.sortAsc,
        filter: s.filter,
        viewMode: s.viewMode,
      }),
    },
  ),
);
