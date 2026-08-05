import { describe, it, expect } from 'vitest';
import { IssueDetector, type IssueSnapshot } from '../src/lib/issueDetector';
import type { ProcessInfo } from '../electron/ipc-types';

const baseSnapshot = (): IssueSnapshot => ({
  cpuTotalPercent: 20,
  processes: [],
  cpuMap: {},
  procHistory: {},
  disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 5e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
});

// 纯 ProcessInfo 构造（cpuPercent 由 IssueSnapshot.cpuMap 承载，不挂在进程对象上）
const proc = (pid: number, name: string, mem: number): ProcessInfo => ({
  pid, ppid: 0, name, cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: mem, createTimeMs: 0, threadCount: 1, handleCount: 0,
});

const disk = (freeBytes: number) => ({ name: 'C:', totalBytes: 1e12, freeBytes, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 });

describe('IssueDetector', () => {
  it('系统 CPU >80% 连续 3 轮触发 alert，第 2 轮不触发', () => {
    const d = new IssueDetector();
    for (let i = 1; i <= 2; i++) {
      const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 85 });
      expect(issues.filter((x) => x.rule === 'system-cpu')).toHaveLength(0);
    }
    const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 85 });
    expect(issues.filter((x) => x.rule === 'system-cpu')).toHaveLength(1);
    expect(issues.find((x) => x.rule === 'system-cpu')!.severity).toBe('alert');
  });

  it('CPU 回落消除问题', () => {
    const d = new IssueDetector();
    for (let i = 0; i < 3; i++) d.update({ ...baseSnapshot(), cpuTotalPercent: 85 });
    const after = d.update({ ...baseSnapshot(), cpuTotalPercent: 30 });
    expect(after.filter((x) => x.rule === 'system-cpu')).toHaveLength(0);
  });

  it('单进程 cpuMap>=100 连续 2 周期触发 locate-process 问题', () => {
    const d = new IssueDetector();
    const p = proc(42, 'node.exe', 5e8);
    d.update({ ...baseSnapshot(), processes: [p], cpuMap: { 42: 120 }, procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }] } });
    const issues = d.update({ ...baseSnapshot(), processes: [p], cpuMap: { 42: 120 }, procHistory: { 42: [{ ts: 2, cpu: 120, mem: 5e8 }] } });
    const issue = issues.find((x) => x.rule === 'process-cpu');
    expect(issue).toBeTruthy();
    expect(issue!.processId).toBe(42);
    expect(issue!.action).toBe('locate-process');
  });

  it('第 1 轮占位不泄漏：返回数组不含 process-cpu 且无 placeholder', () => {
    const d = new IssueDetector();
    const issues = d.update({ ...baseSnapshot(), processes: [proc(42, 'node.exe', 5e8)], cpuMap: { 42: 120 } });
    expect(issues.filter((x) => x.rule === 'process-cpu')).toHaveLength(0);
    expect(issues.some((x) => x.placeholder)).toBe(false);
  });

  it('进程 CPU 回落不再产生问题', () => {
    const d = new IssueDetector();
    d.update({ ...baseSnapshot(), processes: [proc(42, 'node.exe', 5e8)], cpuMap: { 42: 120 }, procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }] } });
    const issues = d.update({ ...baseSnapshot(), processes: [proc(42, 'node.exe', 5e8)], cpuMap: { 42: 10 }, procHistory: { 42: [{ ts: 2, cpu: 10, mem: 5e8 }] } });
    expect(issues.filter((x) => x.rule === 'process-cpu')).toHaveLength(0);
  });

  it('内存 3 样本递增且增幅>15% 触发泄漏问题', () => {
    const d = new IssueDetector();
    const hist = { 7: [{ ts: 1, cpu: 5, mem: 500e6 }, { ts: 2, cpu: 5, mem: 560e6 }, { ts: 3, cpu: 5, mem: 620e6 }] };
    const issues = d.update({ ...baseSnapshot(), processes: [proc(7, 'a.exe', 620e6)], procHistory: hist });
    const issue = issues.find((x) => x.rule === 'memory-growth');
    expect(issue).toBeTruthy();
    expect(issue!.processId).toBe(7);
  });

  it('内存未持续递增不触发', () => {
    const d = new IssueDetector();
    const hist = { 7: [{ ts: 1, cpu: 5, mem: 500e6 }, { ts: 2, cpu: 5, mem: 480e6 }, { ts: 3, cpu: 5, mem: 620e6 }] };
    const issues = d.update({ ...baseSnapshot(), processes: [proc(7, 'a.exe', 620e6)], procHistory: hist });
    expect(issues.filter((x) => x.rule === 'memory-growth')).toHaveLength(0);
  });

  it('磁盘剩余 <10% 触发 alert 问题', () => {
    const d = new IssueDetector();
    const issues = d.update({ ...baseSnapshot(), disks: [disk(8e10)] });
    expect(issues.find((x) => x.rule === 'disk-low')!.severity).toBe('alert');
  });

  it('磁盘剩余恰好 10% 触发 alert（边界与 healthAssess 对齐）', () => {
    const d = new IssueDetector();
    const issues = d.update({ ...baseSnapshot(), disks: [disk(1e11)] });
    const issue = issues.find((x) => x.rule === 'disk-low');
    expect(issue).toBeTruthy();
    expect(issue!.severity).toBe('alert');
  });

  it('同实体去重且上限 10；实体消失后消除', () => {
    const d = new IssueDetector();
    const p = proc(1, 'x.exe', 1e9);
    for (let i = 0; i < 4; i++) {
      const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 90, processes: [p], cpuMap: { 1: 150 }, procHistory: { 1: [{ ts: i, cpu: 150, mem: 1e9 }] }, disks: [disk(5e10)] });
      expect(issues.length).toBeLessThanOrEqual(10);
    }
    const last = d.update({ ...baseSnapshot(), cpuTotalPercent: 90 });
    expect(last.filter((x) => x.rule === 'process-cpu' || x.rule === 'disk-low')).toHaveLength(0);
  });

  it('超过 10 条时截断且 alert 全在前', () => {
    const d = new IssueDetector();
    // 5 个进程：process-cpu（连续 2 轮）+ memory-growth 各 5 条，另加 system-cpu + disk-low → 12 条 > 10
    const processes = [1, 2, 3, 4, 5].map((pid) => proc(pid, `p${pid}.exe`, 1e9));
    const cpuMap: Record<number, number> = { 1: 150, 2: 150, 3: 150, 4: 150, 5: 150 };
    const procHistory: Record<number, { ts: number; cpu: number; mem: number }[]> = {};
    for (const pid of [1, 2, 3, 4, 5]) {
      procHistory[pid] = [{ ts: 1, cpu: 150, mem: 500e6 }, { ts: 2, cpu: 150, mem: 560e6 }, { ts: 3, cpu: 150, mem: 620e6 }];
    }
    const makeSnap = (): IssueSnapshot => ({
      ...baseSnapshot(),
      cpuTotalPercent: 90,
      processes,
      cpuMap,
      procHistory,
      disks: [disk(5e10)],
    });
    d.update(makeSnap());
    d.update(makeSnap());
    const issues = d.update(makeSnap());
    expect(issues).toHaveLength(10);
    expect(issues.filter((x) => x.severity === 'alert')).toHaveLength(2); // system-cpu + disk-low
    expect(issues[0].severity).toBe('alert');
    expect(issues[1].severity).toBe('alert');
  });
});
