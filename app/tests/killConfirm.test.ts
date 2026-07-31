import { describe, it, expect } from 'vitest';
import { formatKillTargets } from '../src/lib/killConfirm';

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
