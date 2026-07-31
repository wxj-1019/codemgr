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
  /** 上次出错时间（UX-27）：成功恢复后仍保留一段时间，错误横幅不至于一闪而过。 */
  lastErrorAt: number | null;
  staleAt: number | null;        // 上次成功采样时间；null=数据新鲜或从未成功（A2）
  // 轮询间隔（ms），0 = 暂停。持久化，重启后保留。
  pollMs: number;
  setPerf: (p: PerfData) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setStaleAt: (ts: number | null) => void;
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
      lastErrorAt: null,
      staleAt: null,
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
          return { current: p, history: next, error: null, staleAt: null };
        }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set((s) => (e !== null ? { error: e, lastErrorAt: Date.now() } : { error: null, lastErrorAt: null })),
      setStaleAt: (ts) => set({ staleAt: ts }),
      setPollMs: (ms) => set({ pollMs: ms }),
      reset: () => set({ current: null, history: [], loading: false, error: null, staleAt: null, pollMs: 1000 }),
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
