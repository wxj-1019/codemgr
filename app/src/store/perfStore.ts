import { create } from 'zustand';
import type { PerfData } from '../../electron/ipc-types';

const HISTORY_LEN = 60; // 60 samples = 60s at 1s interval

interface PerfHistoryPoint {
  t: number; // timestamp
  cpuTotal: number;
  memUsedPercent: number;
}

interface PerfState {
  current: PerfData | null;
  history: PerfHistoryPoint[]; // rolling window of 60
  loading: boolean;
  error: string | null;
  setPerf: (p: PerfData) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const usePerfStore = create<PerfState>((set) => ({
  current: null,
  history: [],
  loading: false,
  error: null,
  setPerf: (p) =>
    set((s) => {
      const point = {
        t: p.timestamp,
        cpuTotal: p.cpu.totalPercent,
        memUsedPercent: p.memory.usedPercent,
      };
      const next = [...s.history, point];
      if (next.length > HISTORY_LEN) next.shift();
      return { current: p, history: next, error: null };
    }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  reset: () => set({ current: null, history: [], loading: false, error: null }),
}));
