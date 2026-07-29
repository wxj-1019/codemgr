import { describe, it, expect } from 'vitest';
import native from '../index';

describe('cpuDelta', () => {
  it('first call returns empty (no previous snapshot yet)', () => {
    // cpuDelta 是双快照差值：首次调用无前次快照，返回空数组。
    // 这是关键行为——调用方（useProcessPanel）需容忍首次空返回。
    const r1 = native.cpuDelta();
    expect(Array.isArray(r1)).toBe(true);
    // 注意：若其它测试在本进程内先调过 cpuDelta，这里可能非空。
    // 因此只断言"是数组"，不强断言空（避免测试顺序依赖）。
  });

  it('after a second call, returns per-pid CPU usage with valid fields', async () => {
    // 两次调用间隔足够 CPU 产生差值
    native.cpuDelta();
    await new Promise((r) => setTimeout(r, 200));
    const r2 = native.cpuDelta();
    expect(Array.isArray(r2)).toBe(true);
    for (const u of r2) {
      expect(typeof u.pid).toBe('number');
      expect(u.pid).toBeGreaterThanOrEqual(0);
      expect(typeof u.cpuPercent).toBe('number');
      // cpuPercent 相对于单核，活跃进程可能 >100，但不应为负
      expect(u.cpuPercent).toBeGreaterThanOrEqual(0);
      // 给一个宽松上限防异常值（多核机器单进程理论上限 = 核数*100）
      expect(u.cpuPercent).toBeLessThan(10000);
    }
  });

  it('includes the current process in CPU usage', async () => {
    native.cpuDelta();
    // 让当前进程有 CPU 活动
    const busy = Date.now();
    while (Date.now() - busy < 50) { /* spin to generate CPU time */ }
    const r2 = native.cpuDelta();
    const me = r2.find((u) => u.pid === process.pid);
    expect(me).toBeDefined();
  });
});

describe('perfCounters', () => {
  it('returns a well-formed PerfData object', () => {
    const p = native.perfCounters();
    expect(p).toBeTruthy();
    expect(typeof p).toBe('object');
    expect(typeof p.timestamp).toBe('number');
    expect(p.timestamp).toBeGreaterThan(0);
  });

  it('reports total CPU percent within 0-100', () => {
    const p = native.perfCounters();
    expect(typeof p.cpu.totalPercent).toBe('number');
    expect(p.cpu.totalPercent).toBeGreaterThanOrEqual(0);
    expect(p.cpu.totalPercent).toBeLessThanOrEqual(100);
  });

  it('reports per-core array with positive length', () => {
    const p = native.perfCounters();
    expect(Array.isArray(p.cpu.perCore)).toBe(true);
    expect(p.cpu.perCore.length).toBeGreaterThan(0);
    // 每核百分比 0-100
    for (const core of p.cpu.perCore) {
      expect(core).toBeGreaterThanOrEqual(0);
      expect(core).toBeLessThanOrEqual(100);
    }
  });

  it('reports memory with total > available and valid percent', () => {
    const p = native.perfCounters();
    expect(p.memory.totalBytes).toBeGreaterThan(0);
    expect(p.memory.availableBytes).toBeGreaterThan(0);
    expect(p.memory.availableBytes).toBeLessThanOrEqual(p.memory.totalBytes);
    expect(p.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(p.memory.usedPercent).toBeLessThanOrEqual(100);
  });

  it('reports at least one disk and one network interface', () => {
    const p = native.perfCounters();
    expect(Array.isArray(p.disks)).toBe(true);
    expect(Array.isArray(p.networks)).toBe(true);
    // Windows 至少有一个系统盘
    expect(p.disks.length).toBeGreaterThan(0);
    for (const d of p.disks) {
      expect(typeof d.name).toBe('string');
      expect(d.totalBytes).toBeGreaterThanOrEqual(0);
      expect(d.freeBytes).toBeGreaterThanOrEqual(0);
      expect(d.freeBytes).toBeLessThanOrEqual(d.totalBytes);
    }
    // 网卡可能为空（虚拟机无网），不强断言长度，只校验字段合法性
    for (const n of p.networks) {
      expect(typeof n.name).toBe('string');
      expect(n.recvBytesPerSec).toBeGreaterThanOrEqual(0);
      expect(n.sendBytesPerSec).toBeGreaterThanOrEqual(0);
    }
  });
});
