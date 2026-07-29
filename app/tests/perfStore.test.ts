import { describe, it, expect, beforeEach } from 'vitest';
import { usePerfStore } from '../src/store/perfStore';
import type { PerfData } from '../electron/ipc-types';

const mockPerf = (over: Partial<PerfData> = {}): PerfData => ({
  cpu: { totalPercent: 10, perCore: [10] },
  memory: { totalBytes: 100, availableBytes: 50, usedPercent: 50 },
  disks: [],
  networks: [],
  gpu: { available: false, totalPercent: 0, vramUsedBytes: 0, vramBudgetBytes: 0, perProcess: [], adapters: [] },
  timestamp: Date.now(),
  ...over,
});

describe('perfStore', () => {
  // persist middleware reads/writes localStorage; clear it before each test so
  // rehydrated state from a prior test can't leak in (reset() alone re-persists).
  beforeEach(() => {
    localStorage.clear();
    usePerfStore.getState().reset();
  });

  it('pollMs defaults to 1000 (perf panel interval)', () => {
    expect(usePerfStore.getState().pollMs).toBe(1000);
  });

  it('setPollMs updates the refresh interval (0 = paused)', () => {
    const st = usePerfStore.getState();
    st.setPollMs(2000);
    expect(usePerfStore.getState().pollMs).toBe(2000);
    st.setPollMs(0);
    expect(usePerfStore.getState().pollMs).toBe(0);
  });

  it('persists pollMs via partialize', () => {
    localStorage.clear();
    const api = (usePerfStore as unknown as {
      persist: { getOptions: () => { partialize: (s: unknown) => unknown } };
    }).persist;
    const persisted = api.getOptions().partialize(usePerfStore.getState());
    // 只持久化刷新间隔偏好；current/history 等运行时数据不存
    expect(persisted).toEqual({ pollMs: 1000 });
  });

  // ── A2: staleAt（采集失败语义）──

  it('setPerf clears staleAt', () => {
    usePerfStore.setState({ staleAt: 1000 });
    usePerfStore.getState().setPerf(mockPerf());
    expect(usePerfStore.getState().staleAt).toBeNull();
  });
});
