import { describe, it, expect } from 'vitest';
import { aggregateSession } from '../src/lib/sessionAggregate';
import type { ProcessInfo, NetConnection } from '../electron/ipc-types';

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'x', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, ...over,
});
const conn = (over: Partial<NetConnection> = {}): NetConnection => ({
  protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0,
  state: 'LISTENING', pid: 1, processName: 'x', ...over,
});

describe('aggregateSession', () => {
  it('single process session', () => {
    const a = aggregateSession(
      [10],
      [proc({ pid: 10, workingSetBytes: 100 * 1024 * 1024 })],
      { 10: 5.5 },
      [],
    );
    expect(a.processCount).toBe(1);
    expect(a.totalCpu).toBe(5.5);
    expect(a.totalMemory).toBe(100 * 1024 * 1024);
    expect(a.listenPortCount).toBe(0);
  });

  it('multi process sums cpu and memory', () => {
    const a = aggregateSession(
      [10, 11],
      [proc({ pid: 10, workingSetBytes: 50 }), proc({ pid: 11, workingSetBytes: 30 })],
      { 10: 10, 11: 20 },
      [],
    );
    expect(a.processCount).toBe(2);
    expect(a.totalCpu).toBe(30);
    expect(a.totalMemory).toBe(80);
  });

  it('counts listening ports owned by session pids', () => {
    const a = aggregateSession(
      [10],
      [proc({ pid: 10 })],
      {},
      [
        conn({ pid: 10, localPort: 5173, state: 'LISTENING' }),
        conn({ pid: 10, localPort: 3000, state: 'LISTENING' }),
        conn({ pid: 10, localPort: 9999, state: 'ESTABLISHED' }),
      ],
    );
    expect(a.listenPortCount).toBe(2);
  });

  it('does not count ports owned by other pids', () => {
    const a = aggregateSession(
      [10],
      [proc({ pid: 10 })],
      {},
      [conn({ pid: 99, localPort: 5173, state: 'LISTENING' })],
    );
    expect(a.listenPortCount).toBe(0);
  });

  it('missing cpuMap entry counts as 0', () => {
    const a = aggregateSession([10, 11], [proc({ pid: 10 }), proc({ pid: 11 })], { 10: 7 }, []);
    expect(a.totalCpu).toBe(7);
  });
});
