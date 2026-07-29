import { describe, it, expect } from 'vitest';
import native from '../index';

describe('perfCounters GPU 字段（v2.1）', () => {
  const perf = native.perfCounters();
  const gpu = perf.gpu;

  it('gpu 字段存在且为对象', () => {
    expect(typeof gpu).toBe('object');
    expect(gpu).not.toBeNull();
  });

  it('available 是 boolean', () => {
    expect(typeof gpu.available).toBe('boolean');
  });

  it('available=true 时 totalPercent ∈ [0,100]', () => {
    if (gpu.available) {
      expect(gpu.totalPercent).toBeGreaterThanOrEqual(0);
      expect(gpu.totalPercent).toBeLessThanOrEqual(100);
    }
  });

  it('available=false 时（虚拟机/远程桌面）totalPercent 为 0', () => {
    if (!gpu.available) {
      expect(gpu.totalPercent).toBe(0);
    }
  });

  it('vramUsedBytes 是非负数', () => {
    expect(gpu.vramUsedBytes).toBeGreaterThanOrEqual(0);
  });

  it('vramBudgetBytes 是非负数（0 = DXGI 失败，总量未知）', () => {
    expect(gpu.vramBudgetBytes).toBeGreaterThanOrEqual(0);
  });

  it('available=true 时 vramUsed <= budget × 1.1（budget 是软上限）', () => {
    if (gpu.available && gpu.vramBudgetBytes > 0) {
      expect(gpu.vramUsedBytes).toBeLessThanOrEqual(gpu.vramBudgetBytes * 1.1);
    }
  });

  it('perProcess 是数组', () => {
    expect(Array.isArray(gpu.perProcess)).toBe(true);
  });

  it('perProcess 每项 pid > 0 且字段类型正确', () => {
    for (const p of gpu.perProcess) {
      expect(p.pid).toBeGreaterThan(0);
      expect(typeof p.gpuPercent).toBe('number');
      expect(typeof p.vramBytes).toBe('number');
    }
  });

  // v2.x 多适配器明细
  it('adapters 是数组', () => {
    expect(Array.isArray(gpu.adapters)).toBe(true);
  });

  it('available=true 时 adapters 每项有 name + 合法字段', () => {
    if (gpu.available) {
      for (const a of gpu.adapters) {
        expect(typeof a.name).toBe('string');
        expect(a.name.length).toBeGreaterThan(0);
        expect(typeof a.totalPercent).toBe('number');
        expect(a.totalPercent).toBeGreaterThanOrEqual(0);
        expect(a.totalPercent).toBeLessThanOrEqual(100);
        expect(typeof a.vramUsedBytes).toBe('number');
        expect(typeof a.vramBudgetBytes).toBe('number');
      }
    }
  });
});
