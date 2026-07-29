import { create } from 'zustand';
import type { NetConnection } from '../../electron/ipc-types';

interface PortRadarState {
  connections: NetConnection[];
  loading: boolean;
  error: string | null;
  selectedPid: number | null;
  filter: string;
  setConnections: (c: NetConnection[]) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  select: (pid: number | null) => void;
  setFilter: (f: string) => void;
  reset: () => void;
}

export const usePortRadarStore = create<PortRadarState>((set) => ({
  connections: [],
  loading: false,
  error: null,
  selectedPid: null,
  filter: '',
  setConnections: (c) => set({ connections: c, error: null }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  select: (pid) => set({ selectedPid: pid }),
  setFilter: (f) => set({ filter: f }),
  reset: () => set({ connections: [], loading: false, error: null, selectedPid: null, filter: '' }),
}));
