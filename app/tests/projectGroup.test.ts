import { describe, it, expect } from 'vitest';
import { groupByProject } from '../src/lib/projectGroup';
import type { ProcessInfo } from '../electron/ipc-types';

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'node.exe', cmdline: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, cwd: '',
  ...over,
});

describe('groupByProject', () => {
  it('groups by identical cwd', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\proj\\app' }),
      p({ pid: 3, cwd: 'C:\\other' }),
    ]);
    expect(groups.length).toBe(2);
    const app = groups.find(g => g.name === 'app');
    expect(app?.pids).toEqual([1, 2]);
  });

  it('group name is last path segment of cwd', () => {
    const groups = groupByProject([p({ pid: 1, cwd: 'C:\\proj\\my-app' })]);
    expect(groups[0].name).toBe('my-app');
  });

  it('processes with empty cwd go to 未分组', () => {
    const groups = groupByProject([p({ pid: 1, cwd: '' }), p({ pid: 2, cwd: '' })]);
    expect(groups[0].name).toBe('未分组');
    expect(groups[0].pids.length).toBe(2);
  });

  it('未分组 always last', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: '' }),
      p({ pid: 2, cwd: 'C:\\proj\\a' }),
    ]);
    expect(groups[groups.length - 1].name).toBe('未分组');
  });

  it('groups sorted by size descending', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\small' }),
      p({ pid: 2, cwd: 'C:\\big' }),
      p({ pid: 3, cwd: 'C:\\big' }),
    ]);
    // big (2 procs) before small (1 proc); 未分组 absent here
    expect(groups[0].pids.length).toBeGreaterThanOrEqual(groups[1].pids.length);
  });
});
