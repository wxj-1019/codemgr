import { describe, it, expect } from 'vitest';
import { formatKillTargets, summarizeKillOutcomes, formatKillFailureSummary } from '../src/lib/killConfirm';
import type { KillOutcome } from '../electron/ipc-types';

const nameOf = (pid: number) => ({ 10: 'vite.exe', 20: 'python.exe' }[pid] ?? '');

describe('formatKillTargets（UX-01 确认框目标清单）', () => {
  it('把 pids 映射为 名称（PID n）清单', () => {
    expect(formatKillTargets([10, 20], nameOf)).toEqual([
      'vite.exe (PID 10)',
      'python.exe (PID 20)',
    ]);
  });

  it('未知名称显示「未知」', () => {
    expect(formatKillTargets([99], nameOf)).toEqual(['未知 (PID 99)']);
  });

  it('超过上限截断并注明余数', () => {
    const pids = Array.from({ length: 20 }, (_, i) => i + 1);
    const lines = formatKillTargets(pids, () => 'node.exe');
    expect(lines).toHaveLength(16);
    expect(lines[15]).toBe('…及另 5 个进程');
  });

  it('空数组 → 空清单', () => {
    expect(formatKillTargets([], nameOf)).toEqual([]);
  });
});

describe('summarizeKillOutcomes（UX-02/04 逐 pid 结果）', () => {
  it('按状态计数', () => {
    const out: KillOutcome[] = [
      { pid: 1, status: 'killed' },
      { pid: 2, status: 'protected' },
      { pid: 3, status: 'denied' },
      { pid: 4, status: 'not-found' },
      { pid: 5, status: 'killed' },
    ];
    expect(summarizeKillOutcomes(out)).toEqual({ killed: 2, protected: 1, denied: 1, notFound: 1 });
  });

  it('空数组 → 全零', () => {
    expect(summarizeKillOutcomes([])).toEqual({ killed: 0, protected: 0, denied: 0, notFound: 0 });
  });
});

describe('formatKillFailureSummary', () => {
  it('只列非零失败项', () => {
    expect(formatKillFailureSummary({ killed: 2, protected: 1, denied: 0, notFound: 1 })).toBe('受保护 1 · 已退出 1');
  });

  it('全部成功返回空串', () => {
    expect(formatKillFailureSummary({ killed: 2, protected: 0, denied: 0, notFound: 0 })).toBe('');
  });
});
