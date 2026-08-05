import { describe, it, expect } from 'vitest';
import { assessHealth, type HealthInput } from '../src/lib/healthAssess';

const base: HealthInput = { cpuPercent: 20, memPercent: 40, diskFreeMinPercent: 50, gpuPercent: null, issueCount: 0 };

describe('assessHealth', () => {
  it('全部正常 → excellent，无 reasons', () => {
    const r = assessHealth(base);
    expect(r.level).toBe('excellent');
    expect(r.reasons).toEqual([]);
  });

  it('单指标 attention → good + 对应 reason', () => {
    const r = assessHealth({ ...base, memPercent: 75 });
    expect(r.level).toBe('good');
    expect(r.reasons).toEqual(['内存使用率 75%']);
  });

  it('最差指标主导：磁盘 8% → alert', () => {
    const r = assessHealth({ ...base, diskFreeMinPercent: 8 });
    expect(r.level).toBe('alert');
    expect(r.reasons).toContain('磁盘剩余 8%');
  });

  it('issueCount>=2 且整体 good → 降一档 attention', () => {
    const r = assessHealth({ ...base, memPercent: 75, issueCount: 2 });
    expect(r.level).toBe('attention');
  });

  it('issueCount 修正不越过 alert：alert 指标 + 多问题仍 alert', () => {
    const r = assessHealth({ ...base, memPercent: 90, issueCount: 3 });
    expect(r.level).toBe('alert');
  });

  it('边界值：内存 70 为 attention、85 为 alert（≥attentionAt 即 attention）', () => {
    expect(assessHealth({ ...base, memPercent: 70 }).level).toBe('good');
    expect(assessHealth({ ...base, memPercent: 85 }).level).toBe('alert');
  });

  it('GPU null（无 GPU）不参与评估', () => {
    const r = assessHealth({ ...base, gpuPercent: null });
    expect(r.level).toBe('excellent');
  });
});
