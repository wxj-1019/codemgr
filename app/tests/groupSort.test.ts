import { describe, it, expect } from 'vitest';
import { sortGroups, sortGroupProcs } from '../src/lib/groupSort';
import type { ProjectGroup } from '../src/lib/projectGroup';
import type { ProcessInfo } from '../electron/ipc-types';

const mkProc = (pid: number, name: string, mem: number): ProcessInfo => ({
  pid, ppid: 1, name, cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: mem, createTimeMs: 0, threadCount: 1, handleCount: 1,
});
const groups: ProjectGroup[] = [
  { name: 'beta', dir: 'D:\\b', pids: [1], totalMemory: 100 },
  { name: 'alpha', dir: 'D:\\a', pids: [2, 3], totalMemory: 300 },
  { name: 'gamma', dir: null, pids: [4], totalMemory: 200 },
];

describe('sortGroups', () => {
  it('按名称 asc/desc', () => {
    expect(sortGroups(groups, 'name', 'asc').map((g) => g.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortGroups(groups, 'name', 'desc').map((g) => g.name)).toEqual(['gamma', 'beta', 'alpha']);
  });
  it('按合计内存 desc；cpu/pid 保持原序', () => {
    expect(sortGroups(groups, 'memory', 'desc').map((g) => g.totalMemory)).toEqual([300, 200, 100]);
    expect(sortGroups(groups, 'cpu', 'desc').map((g) => g.name)).toEqual(['beta', 'alpha', 'gamma']);
    expect(sortGroups(groups, 'pid', 'asc').map((g) => g.name)).toEqual(['beta', 'alpha', 'gamma']);
  });
  it('同值稳定（保持原相对序）', () => {
    const same: ProjectGroup[] = [
      { name: 'b', dir: null, pids: [], totalMemory: 1 },
      { name: 'a', dir: null, pids: [], totalMemory: 1 },
    ];
    expect(sortGroups(same, 'memory', 'asc').map((g) => g.name)).toEqual(['b', 'a']);
  });
});

describe('sortGroupProcs', () => {
  const procs = [mkProc(3, 'c.exe', 300), mkProc(1, 'a.exe', 100), mkProc(2, 'b.exe', 200)];
  const cpu = { 1: 50, 2: 10, 3: 90 };
  it('四键排序', () => {
    expect(sortGroupProcs(procs, 'name', 'asc', cpu).map((p) => p.name)).toEqual(['a.exe', 'b.exe', 'c.exe']);
    expect(sortGroupProcs(procs, 'cpu', 'desc', cpu).map((p) => p.pid)).toEqual([3, 1, 2]);
    expect(sortGroupProcs(procs, 'memory', 'asc', cpu).map((p) => p.workingSetBytes)).toEqual([100, 200, 300]);
    expect(sortGroupProcs(procs, 'pid', 'asc', cpu).map((p) => p.pid)).toEqual([1, 2, 3]);
  });
  it('cpu 缺失按 0 处理', () => {
    expect(sortGroupProcs([mkProc(9, 'z.exe', 1)], 'cpu', 'desc', {}).map((p) => p.pid)).toEqual([9]);
  });
});
