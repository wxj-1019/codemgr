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

describe('killByPids guard list', () => {
  // 保护名单（与 process_ops.cpp IsProtected 保持一致）
  const PROTECTED = [
    'System', 'Registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
    'services.exe', 'lsass.exe', 'svchost.exe', 'electron.exe',
  ];

  it('returns a number for an empty pid list', () => {
    const killed = native.killByPids([]);
    expect(typeof killed).toBe('number');
    expect(killed).toBe(0);
  });

  it('never kills a protected name (svchost/system) — returns 0', () => {
    const procs = native.processScan();
    const lower = new Set(PROTECTED.map((n) => n.toLowerCase()));
    const protectedPids = procs
      .filter((p) => lower.has(p.name.toLowerCase()))
      .map((p) => p.pid);
    // 任何 Windows 都至少有一个 svchost.exe / services.exe
    expect(protectedPids.length).toBeGreaterThan(0);
    const killed = native.killByPids(protectedPids);
    expect(killed).toBe(0);
  });
});

describe('killByName guard list', () => {
  it('never kills svchost.exe even when targeted by name', () => {
    const killed = native.killByName('svchost.exe');
    // svchost.exe 在保护名单内 —— 必须返回 0（即便系统里有几十个）
    expect(killed).toBe(0);
  });
});

