import { describe, it, expect } from 'vitest';
import { IssueDetector, type IssueSnapshot } from '../src/lib/issueDetector';
import type { ProcessInfo } from '../electron/ipc-types';

const baseSnapshot = (): IssueSnapshot => ({
  cpuTotalPercent: 20,
  processes: [],
  procHistory: {},
  disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 5e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
});

const proc = (pid: number, name: string, cpu: number, mem: number): ProcessInfo =>
  ({ pid, ppid: 0, name, cmdline: '', cpuPercent: cpu, workingSetBytes: mem, createTimeMs: 0, threads: 1, sessionId: 0, username: '', isElevated: false, kind: 'other' } as ProcessInfo);

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

  it('单进程 cpuPercent>=100 连续 2 周期触发 locate-process 问题', () => {
    const d = new IssueDetector();
    const p = proc(42, 'node.exe', 120, 5e8);
    d.update({ ...baseSnapshot(), processes: [p], procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }] } });
    const issues = d.update({ ...baseSnapshot(), processes: [p], procHistory: { 42: [{ ts: 2, cpu: 120, mem: 5e8 }] } });
    const issue = issues.find((x) => x.rule === 'process-cpu');
    expect(issue).toBeTruthy();
    expect(issue!.processId).toBe(42);
    expect(issue!.action).toBe('locate-process');
  });

  it('进程 CPU 回落不再产生问题', () => {
    const d = new IssueDetector();
    const p = proc(42, 'node.exe', 120, 5e8);
    d.update({ ...baseSnapshot(), processes: [p], procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }] } });
    const low = proc(42, 'node.exe', 10, 5e8);
    const issues = d.update({ ...baseSnapshot(), processes: [low], procHistory: { 42: [{ ts: 2, cpu: 10, mem: 5e8 }] } });
    expect(issues.filter((x) => x.rule === 'process-cpu')).toHaveLength(0);
  });

  it('内存 3 样本递增且增幅>15% 触发泄漏问题', () => {
    const d = new IssueDetector();
    const hist = { 7: [{ ts: 1, cpu: 5, mem: 500e6 }, { ts: 2, cpu: 5, mem: 560e6 }, { ts: 3, cpu: 5, mem: 620e6 }] };
    const issues = d.update({ ...baseSnapshot(), processes: [proc(7, 'a.exe', 5, 620e6)], procHistory: hist });
    const issue = issues.find((x) => x.rule === 'memory-growth');
    expect(issue).toBeTruthy();
    expect(issue!.processId).toBe(7);
  });

  it('内存未持续递增不触发', () => {
    const d = new IssueDetector();
    const hist = { 7: [{ ts: 1, cpu: 5, mem: 500e6 }, { ts: 2, cpu: 5, mem: 480e6 }, { ts: 3, cpu: 5, mem: 620e6 }] };
    const issues = d.update({ ...baseSnapshot(), processes: [proc(7, 'a.exe', 5, 620e6)], procHistory: hist });
    expect(issues.filter((x) => x.rule === 'memory-growth')).toHaveLength(0);
  });

  it('磁盘剩余 <10% 触发 alert 问题', () => {
    const d = new IssueDetector();
    const issues = d.update({ ...baseSnapshot(), disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 8e10, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }] });
    expect(issues.find((x) => x.rule === 'disk-low')!.severity).toBe('alert');
  });

  it('同实体去重且上限 10；实体消失后消除', () => {
    const d = new IssueDetector();
    const p = proc(1, 'x.exe', 150, 1e9);
    for (let i = 0; i < 4; i++) {
      const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 90, processes: [p], procHistory: { 1: [{ ts: i, cpu: 150, mem: 1e9 }] }, disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 5e10, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }] });
      expect(issues.length).toBeLessThanOrEqual(10);
    }
    const last = d.update({ ...baseSnapshot(), cpuTotalPercent: 90 });
    expect(last.filter((x) => x.rule === 'process-cpu' || x.rule === 'disk-low')).toHaveLength(0);
  });
});
