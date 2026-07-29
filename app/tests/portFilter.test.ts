import { describe, it, expect } from 'vitest';
import { filterConnections, isListenLike, conflictPorts } from '../src/lib/portFilter';
import type { NetConnection } from '../electron/ipc-types';

const conn = (over: Partial<NetConnection> = {}): NetConnection => ({
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

describe('isListenLike', () => {
  it('keeps LISTENING tcp and all udp, drops transient tcp states', () => {
    expect(isListenLike(conn())).toBe(true);
    expect(isListenLike(conn({ protocol: 'udp', state: '' }))).toBe(true);
    expect(isListenLike(conn({ state: 'ESTABLISHED' }))).toBe(false);
    expect(isListenLike(conn({ state: 'TIME_WAIT' }))).toBe(false);
  });
});

describe('filterConnections', () => {
  const list = [
    conn({ localPort: 3000, processName: 'node', pid: 100 }),
    conn({ localPort: 5432, processName: 'postgres', pid: 200 }),
    conn({ localPort: 8080, processName: 'java', pid: 300, localAddr: '127.0.0.1' }),
  ];

  it('empty query returns the original list', () => {
    expect(filterConnections(list, '')).toBe(list);
    expect(filterConnections(list, '   ')).toBe(list);
  });

  it('matches by port number', () => {
    expect(filterConnections(list, '5432').map((c) => c.localPort)).toEqual([5432]);
  });

  it('matches by process name, case-insensitive', () => {
    expect(filterConnections(list, 'NODE').map((c) => c.pid)).toEqual([100]);
  });

  it('matches by pid and local address', () => {
    expect(filterConnections(list, '200').map((c) => c.localPort)).toEqual([5432]);
    expect(filterConnections(list, '127.0.0').map((c) => c.localPort)).toEqual([8080]);
  });

  it('no match returns empty array', () => {
    expect(filterConnections(list, 'zzzz')).toEqual([]);
  });
});

describe('conflictPorts', () => {
  it('flags a port listened by two different pids', () => {
    const list = [
      conn({ localPort: 8080, pid: 100 }),
      conn({ localPort: 8080, pid: 200 }),
      conn({ localPort: 3000, pid: 100 }),
    ];
    const conflicts = conflictPorts(list);
    expect(conflicts.has('tcp:8080')).toBe(true);
    expect(conflicts.has('tcp:3000')).toBe(false);
  });

  it('same pid bound to multiple addresses is NOT a conflict', () => {
    const list = [
      conn({ localPort: 8080, pid: 100, localAddr: '0.0.0.0' }),
      conn({ localPort: 8080, pid: 100, localAddr: '::' }),
    ];
    expect(conflictPorts(list).size).toBe(0);
  });

  it('ignores non-listen connections', () => {
    const list = [
      conn({ localPort: 8080, pid: 100, state: 'ESTABLISHED' }),
      conn({ localPort: 8080, pid: 200 }),
    ];
    expect(conflictPorts(list).size).toBe(0);
  });

  it('same port on different protocols is NOT a conflict', () => {
    const list = [
      conn({ localPort: 53, pid: 100, protocol: 'tcp', state: 'LISTENING' }),
      conn({ localPort: 53, pid: 200, protocol: 'udp' }),
    ];
    expect(conflictPorts(list).size).toBe(0);
  });
});
