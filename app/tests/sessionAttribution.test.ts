import { describe, it, expect } from 'vitest';
import { buildSessions } from '../src/lib/sessionAttribution';
import type { ProcessInfo } from '../electron/ipc-types';

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'x.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, ...over,
});

// 注入式种子判定：测试不依赖真实 labelForProcess，按 pid 显式标记种子
const seedOf = (seedPids: Set<number>) => (proc: ProcessInfo) =>
  seedPids.has(proc.pid) ? { kind: 'ai', label: 'seed' } : null;

describe('buildSessions', () => {
  it('collects root + direct children into one session', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }),
      p({ pid: 11, ppid: 10 }),
      p({ pid: 12, ppid: 10 }),
      p({ pid: 99, ppid: 1 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rootPid).toBe(10);
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it('collects deep descendants (root→a→b→c)', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }),
      p({ pid: 11, ppid: 10 }),
      p({ pid: 12, ppid: 11 }),
      p({ pid: 13, ppid: 12 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });

  it('returns empty array when no seed', () => {
    const procs = [p({ pid: 10, ppid: 1 }), p({ pid: 11, ppid: 10 })];
    expect(buildSessions(procs, { isSeed: seedOf(new Set()) })).toEqual([]);
  });

  it('produces multiple sessions for independent roots', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }), p({ pid: 11, ppid: 10 }),
      p({ pid: 20, ppid: 1 }), p({ pid: 21, ppid: 20 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10, 20])) });
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.rootPid).sort();
    expect(ids).toEqual([10, 20]);
  });

  it('first seed claims seed that is also its descendant (no duplicate)', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }),  // rootA seed
      p({ pid: 20, ppid: 10 }), // rootB seed（但也是 rootA 的子）
      p({ pid: 30, ppid: 20 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10, 20])) });
    // rootA 先认领 20（作为后代），20 不再独立成 session
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rootPid).toBe(10);
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('does not infinite-loop on ppid cycle (A.ppid=B, B.ppid=A)', () => {
    const procs = [
      p({ pid: 10, ppid: 20 }),
      p({ pid: 20, ppid: 10 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('skips self-referencing ppid (p.ppid === p.pid)', () => {
    const procs = [
      p({ pid: 10, ppid: 10 }),
      p({ pid: 11, ppid: 10 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('session identity is rootPid:createTimeMs', () => {
    const procs = [p({ pid: 10, ppid: 1, createTimeMs: 12345 })];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions[0].id).toBe('10:12345');
  });

  it('seed with no descendants is still a valid session', () => {
    const procs = [p({ pid: 10, ppid: 1 })];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pids).toEqual([10]);
  });
});
