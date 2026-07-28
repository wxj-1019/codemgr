import { create } from 'zustand';
import type { ProcessInfo } from '../../electron/ipc-types';

interface ProcessPanelState {
  processes: ProcessInfo[];
  cpuMap: Record<number, number>;   // pid -> cpuPercent
  filter: string;
  sortKey: 'pid' | 'name' | 'cpu' | 'memory';
  sortAsc: boolean;
  expandedPids: Set<number>;
  selectedPids: Set<number>;
  loading: boolean;
  error: string | null;

  setProcesses: (p: ProcessInfo[]) => void;
  setCpuMap: (c: { pid: number; cpuPercent: number }[]) => void;
  setFilter: (f: string) => void;
  setSortKey: (k: ProcessPanelState['sortKey']) => void;
  toggleSort: () => void;
  toggleExpand: (pid: number) => void;
  toggleSelect: (pid: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useProcessPanelStore = create<ProcessPanelState>((set) => ({
  processes: [],
  cpuMap: {},
  filter: '',
  sortKey: 'pid',
  sortAsc: true,
  expandedPids: new Set<number>(),
  selectedPids: new Set<number>(),
  loading: false,
  error: null,

  setProcesses: (p) => set({ processes: p, error: null }),
  setCpuMap: (c) => set((s) => {
    const m = { ...s.cpuMap };
    for (const x of c) m[x.pid] = x.cpuPercent;
    return { cpuMap: m };
  }),
  setFilter: (f) => set({ filter: f }),
  setSortKey: (k) => set({ sortKey: k }),
  toggleSort: () => set((s) => ({ sortAsc: !s.sortAsc })),
  toggleExpand: (pid) => set((s) => {
    const next = new Set(s.expandedPids);
    next.has(pid) ? next.delete(pid) : next.add(pid);
    return { expandedPids: next };
  }),
  toggleSelect: (pid) => set((s) => {
    const next = new Set(s.selectedPids);
    next.has(pid) ? next.delete(pid) : next.add(pid);
    return { selectedPids: next };
  }),
  selectAll: () => set((s) => ({
    selectedPids: new Set(s.processes.map(p => p.pid))
  })),
  clearSelection: () => set({ selectedPids: new Set() }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  reset: () => set({
    processes: [], cpuMap: {}, filter: '', sortKey: 'pid', sortAsc: true,
    expandedPids: new Set(), selectedPids: new Set(), loading: false, error: null,
  }),
}));
