import { describe, it, expect } from 'vitest';
import { resolveServiceStatus } from '../src/lib/devService';
import type { RunState, RunProfile, NetConnection } from '../electron/ipc-types';

const run = (over: Partial<RunState> = {}): RunState => ({
  runId: 'r1', profileId: 'p1', pid: 100, status: 'running', exitCode: null, startedAt: 0, ...over,
});
const profile = (over: Partial<RunProfile> = {}): RunProfile => ({
  id: 'p1', name: 'x', command: 'pnpm', args: ['dev'], cwd: 'E:\\repo', ...over,
});
const conn = (over: Partial<NetConnection> = {}): NetConnection => ({
  protocol: 'tcp', localAddr: '0.0.0.0', localPort: 5173, remoteAddr: '', remotePort: 0,
  state: 'LISTENING', pid: 100, processName: 'x', ...over,
});

describe('resolveServiceStatus', () => {
  it('exited run → exited', () => {
    expect(resolveServiceStatus(run({ status: 'exited', exitCode: 0 }), profile({ expectedPorts: [5173] }), [])).toEqual({ kind: 'exited' });
  });

  it('no expectedPorts → no-ports', () => {
    expect(resolveServiceStatus(run(), profile({}), [])).toEqual({ kind: 'no-ports' });
  });

  it('expectedPort held by run pid → listening', () => {
    const s = resolveServiceStatus(run({ pid: 100 }), profile({ expectedPorts: [5173] }), [conn({ pid: 100, localPort: 5173 })]);
    expect(s.kind).toBe('listening');
    expect(s.ports![0].heldBy).toBe(100);
    expect(s.ports![0].conflict).toBe(false);
  });

  it('expectedPort held by other pid → conflict', () => {
    const s = resolveServiceStatus(run({ pid: 100 }), profile({ expectedPorts: [5173] }), [conn({ pid: 999, localPort: 5173 })]);
    expect(s.kind).toBe('conflict');
    expect(s.ports![0].conflict).toBe(true);
    expect(s.ports![0].heldBy).toBe(999);
  });

  it('expectedPort not held, run running → starting', () => {
    const s = resolveServiceStatus(run({ pid: 100 }), profile({ expectedPorts: [5173] }), []);
    expect(s.kind).toBe('starting');
    expect(s.ports![0].heldBy).toBeNull();
  });

  it('multi-port: one listening one not → starting', () => {
    const s = resolveServiceStatus(
      run({ pid: 100 }),
      profile({ expectedPorts: [5173, 3000] }),
      [conn({ pid: 100, localPort: 5173 })],
    );
    expect(s.kind).toBe('starting');
  });

  it('multi-port: any conflict → conflict', () => {
    const s = resolveServiceStatus(
      run({ pid: 100 }),
      profile({ expectedPorts: [5173, 3000] }),
      [conn({ pid: 100, localPort: 5173 }), conn({ pid: 999, localPort: 3000 })],
    );
    expect(s.kind).toBe('conflict');
  });

  it('non-listening connections are ignored', () => {
    const s = resolveServiceStatus(
      run({ pid: 100 }),
      profile({ expectedPorts: [5173] }),
      [conn({ pid: 100, localPort: 5173, state: 'ESTABLISHED' })],
    );
    expect(s.kind).toBe('starting');
  });
});
