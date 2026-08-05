import { describe, it, expect } from 'vitest';
import { scanCleanupCandidates, CLEANUP_LIST_CAP } from '../src/lib/cleanupScanner';
import type { ProcessInfo } from '../electron/ipc-types';
import type { Issue } from '../src/lib/issueDetector';

const proc = (pid: number, name: string, mem: number): ProcessInfo =>
  ({ pid, ppid: 0, name, cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: mem, createTimeMs: 0, threadCount: 1, handleCount: 1 });
const issue = (pid: number, rule: 'process-cpu' | 'memory-growth'): Issue =>
  ({ id: `${rule}:${pid}`, rule, severity: 'attention', title: 't', detail: 'd', processId: pid, action: 'locate-process' });

describe('scanCleanupCandidates', () => {
  it('issue 目标（process-cpu/memory-growth）进入候选', () => {
    const procs = [proc(42, 'node.exe', 5e8), proc(7, 'a.exe', 3e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: { 42: 120, 7: 5 }, issues: [issue(42, 'process-cpu')] });
    expect(out.map((c) => c.pid)).toEqual([42]);
    expect(out[0].reason).toBe('issue-target');
    expect(out[0].cpuPercent).toBe(120);
  });

  it('大内存（>1.5GB 默认）进入候选，按内存降序', () => {
    const procs = [proc(1, 'big.exe', 2e9), proc(2, 'mid.exe', 1e9), proc(3, 'huge.exe', 3e9)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [] });
    expect(out.map((c) => c.pid)).toEqual([3, 1]);
    expect(out.every((c) => c.reason === 'large-memory')).toBe(true);
  });

  it('issue 目标排在大内存前（优先级）', () => {
    const procs = [proc(1, 'big.exe', 2e9), proc(2, 'issue.exe', 1e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [issue(2, 'memory-growth')] });
    expect(out.map((c) => c.pid)).toEqual([2, 1]);
  });

  it('已退出进程（issue 有但快照无）剔除', () => {
    const procs = [proc(42, 'node.exe', 5e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [issue(42, 'process-cpu'), issue(99, 'memory-growth')] });
    expect(out.map((c) => c.pid)).toEqual([42]);
  });

  it('保留 pid 0/4/8 排除（即使大内存）', () => {
    const procs = [proc(0, 'System Idle', 0), proc(4, 'System', 3e9), proc(8, 'Registry', 2e9), proc(42, 'node.exe', 4e9)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [] });
    expect(out.map((c) => c.pid)).toEqual([42]);
  });

  it('上限 CLEANUP_LIST_CAP=15', () => {
    const procs = Array.from({ length: 30 }, (_, i) => proc(100 + i, `p${i}.exe`, 2e9));
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [] });
    expect(out).toHaveLength(CLEANUP_LIST_CAP);
    expect(CLEANUP_LIST_CAP).toBe(15);
  });

  it('自定义大内存阈值', () => {
    const procs = [proc(1, 'a.exe', 5e8), proc(2, 'b.exe', 9e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [], largeMemoryBytes: 8e8 });
    expect(out.map((c) => c.pid)).toEqual([2]);
  });
});
