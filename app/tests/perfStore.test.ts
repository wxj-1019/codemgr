import { describe, it, expect, beforeEach } from 'vitest';
import { usePerfStore } from '../src/store/perfStore';

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
});
