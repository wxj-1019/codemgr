import { create } from 'zustand';
import type { NetConnection } from '../../electron/ipc-types';

interface PortRadarState {
  connections: NetConnection[];
  loading: boolean;
  error: string | null;
  selectedPid: number | null;
  setConnections: (c: NetConnection[]) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  select: (pid: number | null) => void;
  reset: () => void;
}

export const usePortRadarStore = create<PortRadarState>((set) => ({
  connections: [],
  loading: false,
  error: null,
  selectedPid: null,
  setConnections: (c) => set({ connections: c, error: null }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  select: (pid) => set({ selectedPid: pid }),
  reset: () => set({ connections: [], loading: false, error: null, selectedPid: null }),
}));
