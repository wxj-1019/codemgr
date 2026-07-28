import { describe, it, expect } from 'vitest';
import native from '../index';

describe('processScan', () => {
  it('returns a non-empty array', () => {
    const procs = native.processScan();
    expect(procs.length).toBeGreaterThan(50); // 任何 Windows 至少几十个进程
  });

  it('includes current process (node)', () => {
    const procs = native.processScan();
    const me = process.pid;
    const found = procs.find(p => p.pid === me);
    expect(found).toBeDefined();
    expect(found!.name.toLowerCase()).toContain('node');
  });

  it('all entries have required fields', () => {
    const procs = native.processScan();
    for (const p of procs) {
      expect(typeof p.pid).toBe('number');
      expect(typeof p.ppid).toBe('number');
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.workingSetBytes).toBe('number');
      expect(p.workingSetBytes).toBeGreaterThanOrEqual(0);
    }
  });

  it('captures the Idle process (pid 0)', () => {
    const procs = native.processScan();
    const idle = procs.find(p => p.pid === 0);
    expect(idle).toBeDefined();
  });
});
