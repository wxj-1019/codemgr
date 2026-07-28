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
  beforeEach(() => {
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
});
