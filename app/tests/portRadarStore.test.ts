import { describe, it, expect, beforeEach } from 'vitest';
import { usePortRadarStore } from '../src/store/portRadarStore';
import type { NetConnection } from '../electron/ipc-types';

const sampleConn = (over: Partial<NetConnection> = {}): NetConnection => ({
  protocol: 'tcp',
  localAddr: '0.0.0.0',
  localPort: 3000,
  remoteAddr: '*',
  remotePort: 0,
  state: 'LISTENING',
  pid: 1234,
  processName: 'node',
  ...over,
});

describe('portRadarStore', () => {
  // persist middleware reads/writes localStorage; clear it before each test so
  // rehydrated state from a prior test can't leak in (reset() alone re-persists).
  beforeEach(() => {
    localStorage.clear();
    usePortRadarStore.getState().reset();
  });

  it('starts empty, not loading', () => {
    const s = usePortRadarStore.getState();
    expect(s.connections).toEqual([]);
    expect(s.loading).toBe(false);
    expect(s.selectedPid).toBeNull();
  });

  it('setConnections replaces the list', () => {
    usePortRadarStore.getState().setConnections([sampleConn({ pid: 1 }), sampleConn({ pid: 2 })]);
    expect(usePortRadarStore.getState().connections.length).toBe(2);
  });

  it('select/deselect pid', () => {
    usePortRadarStore.getState().select(42);
    expect(usePortRadarStore.getState().selectedPid).toBe(42);
    usePortRadarStore.getState().select(null);
    expect(usePortRadarStore.getState().selectedPid).toBeNull();
  });

  it('setLoading toggles', () => {
    usePortRadarStore.getState().setLoading(true);
    expect(usePortRadarStore.getState().loading).toBe(true);
  });

  it('setFilter stores the query and reset clears it', () => {
    usePortRadarStore.getState().setFilter('8080');
    expect(usePortRadarStore.getState().filter).toBe('8080');
    usePortRadarStore.getState().reset();
    expect(usePortRadarStore.getState().filter).toBe('');
  });

  it('pollMs defaults to 3000 (port radar interval)', () => {
    expect(usePortRadarStore.getState().pollMs).toBe(3000);
  });

  it('setPollMs updates the refresh interval (0 = paused)', () => {
    const st = usePortRadarStore.getState();
    st.setPollMs(1000);
    expect(usePortRadarStore.getState().pollMs).toBe(1000);
    st.setPollMs(0);
    expect(usePortRadarStore.getState().pollMs).toBe(0);
  });

  it('persists pollMs via partialize', () => {
    localStorage.clear();
    const api = (usePortRadarStore as unknown as {
      persist: { getOptions: () => { partialize: (s: unknown) => unknown } };
    }).persist;
    const persisted = api.getOptions().partialize(usePortRadarStore.getState());
    // 只持久化刷新间隔偏好；connections/selectedPid 等运行时数据不存
    expect(persisted).toEqual({ pollMs: 3000 });
  });

  // ── A2: staleAt（采集失败语义）──

  it('setConnections clears staleAt', () => {
    usePortRadarStore.setState({ staleAt: 1000 });
    usePortRadarStore.getState().setConnections([]);
    expect(usePortRadarStore.getState().staleAt).toBeNull();
  });
});

describe('portRadarStore lastErrorAt（UX-27 错误横幅保留窗口）', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortRadarStore.getState().reset();
  });

  it('setError(消息) 记录 lastErrorAt', () => {
    usePortRadarStore.getState().setError('boom');
    const s = usePortRadarStore.getState();
    expect(s.error).toBe('boom');
    expect(s.lastErrorAt).not.toBeNull();
  });

  it('成功（setConnections）保留 lastErrorAt——横幅不随恢复一闪而过', () => {
    usePortRadarStore.getState().setError('boom');
    const lastErrorAt = usePortRadarStore.getState().lastErrorAt;
    usePortRadarStore.getState().setConnections([sampleConn()]);
    const s = usePortRadarStore.getState();
    expect(s.error).toBeNull();
    expect(s.lastErrorAt).toBe(lastErrorAt);
  });

  it('手动清除（setError(null)）同时清 lastErrorAt——关闭按钮可彻底关掉横幅', () => {
    usePortRadarStore.getState().setError('boom');
    usePortRadarStore.getState().setError(null);
    const s = usePortRadarStore.getState();
    expect(s.error).toBeNull();
    expect(s.lastErrorAt).toBeNull();
  });
});
