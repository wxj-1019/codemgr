import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PerfData } from '../../electron/ipc-types';

const HISTORY_LEN = 60; // 60 samples = 60s at 1s interval

interface PerfHistoryPoint {
  t: number; // timestamp
  cpuTotal: number;
  memUsedPercent: number;
  gpuTotal: number; // GPU 总使用率（available=false 时为 0，仍采点以保持窗口连续）
}

interface PerfState {
  current: PerfData | null;
  history: PerfHistoryPoint[]; // rolling window of 60
  loading: boolean;
  error: string | null;
  // 轮询间隔（ms），0 = 暂停。持久化，重启后保留。
  pollMs: number;
  setPerf: (p: PerfData) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setPollMs: (ms: number) => void;
  reset: () => void;
}

export const usePerfStore = create<PerfState>()(
  persist(
    (set) => ({
      current: null,
      history: [],
      loading: false,
      error: null,
      pollMs: 1000,  // 性能面板默认 1s（与原硬编码 POLL_MS 一致）
      setPerf: (p) =>
        set((s) => {
          const point = {
            t: p.timestamp,
            cpuTotal: p.cpu.totalPercent,
            memUsedPercent: p.memory.usedPercent,
            gpuTotal: p.gpu.available ? p.gpu.totalPercent : 0,
          };
          const next = [...s.history, point];
          if (next.length > HISTORY_LEN) next.shift();
          return { current: p, history: next, error: null };
        }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set({ error: e }),
      setPollMs: (ms) => set({ pollMs: ms }),
      reset: () => set({ current: null, history: [], loading: false, error: null, pollMs: 1000 }),
    }),
    {
      name: 'codemgr:perf',
      // 只持久化刷新间隔偏好；current/history 等是运行时数据，不存
      partialize: (s) => ({
        pollMs: s.pollMs,
      }),
    },
  ),
);
