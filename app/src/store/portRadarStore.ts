import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NetConnection } from '../../electron/ipc-types';

interface PortRadarState {
  connections: NetConnection[];
  loading: boolean;
  error: string | null;
  staleAt: number | null;        // 上次成功采样时间；null=数据新鲜或从未成功（A2）
  selectedPid: number | null;
  filter: string;
  // 轮询间隔（ms），0 = 暂停。持久化，重启后保留。
  pollMs: number;
  setConnections: (c: NetConnection[]) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setStaleAt: (ts: number | null) => void;
  select: (pid: number | null) => void;
  setFilter: (f: string) => void;
  setPollMs: (ms: number) => void;
  reset: () => void;
}

export const usePortRadarStore = create<PortRadarState>()(
  persist(
    (set) => ({
      connections: [],
      loading: false,
      error: null,
      staleAt: null,
      selectedPid: null,
      filter: '',
      pollMs: 3000,  // 端口雷达默认 3s（与原硬编码 POLL_MS 一致）
      setConnections: (c) => set({ connections: c, error: null, staleAt: null }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set({ error: e }),
      setStaleAt: (ts) => set({ staleAt: ts }),
      select: (pid) => set({ selectedPid: pid }),
      setFilter: (f) => set({ filter: f }),
      setPollMs: (ms) => set({ pollMs: ms }),
      reset: () => set({
        connections: [], loading: false, error: null, staleAt: null, selectedPid: null, filter: '',
        pollMs: 3000,
      }),
    }),
    {
      name: 'codemgr:port-radar',
      // 只持久化刷新间隔偏好；connections/selectedPid 等是运行时数据，不存
      partialize: (s) => ({
        pollMs: s.pollMs,
      }),
    },
  ),
);
