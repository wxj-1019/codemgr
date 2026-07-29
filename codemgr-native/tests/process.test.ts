import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
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
    'services.exe', 'lsass.exe', 'svchost.exe', 'electron.exe', 'Idle',
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

describe('killProcess guard list', () => {
  // 保护名单（与 killByPids 的 PROTECTED 一致）
  const PROTECTED = [
    'System', 'Registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
    'services.exe', 'lsass.exe', 'svchost.exe', 'electron.exe', 'Idle',
  ];

  it('refuses to kill a protected pid (svchost/services) — returns false', () => {
    const procs = native.processScan();
    const lower = new Set(PROTECTED.map((n) => n.toLowerCase()));
    const protectedPid = procs.find((p) => lower.has(p.name.toLowerCase()))?.pid;
    // 任何 Windows 都至少有一个 svchost.exe / services.exe
    expect(protectedPid).toBeDefined();
    // 单进程 kill 必须复用保护名单（原先绕过了守卫）
    const ok = native.killProcess(protectedPid!);
    expect(ok).toBe(false);
  });

  it('refuses to kill pid 0 (Idle)', () => {
    expect(native.killProcess(0)).toBe(false);
  });
});

describe('killTree', () => {
  it('kills a spawned parent together with its child', async () => {
    // 父进程：spawn 一个 node 孙进程后挂起
    const parent = spawn(process.execPath, [
      '-e',
      `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' }); setTimeout(()=>{}, 60000);`,
    ], { stdio: 'ignore' });

    try {
      // 等孙进程起来（最多 5s）
      let childSeen = false;
      for (let i = 0; i < 10 && !childSeen; i++) {
        await new Promise((r) => setTimeout(r, 500));
        childSeen = native.processScan().some((p) => p.ppid === parent.pid);
      }
      expect(childSeen).toBe(true);

      const killed = native.killTree(parent.pid!);
      expect(killed).toBeGreaterThanOrEqual(2); // 父 + 孙

      // TerminateProcess 的 teardown 是异步的，轮询等待父进程真正消失
      let parentGone = false;
      for (let i = 0; i < 6 && !parentGone; i++) {
        await new Promise((r) => setTimeout(r, 500));
        parentGone = !native.processScan().some((p) => p.pid === parent.pid);
      }
      expect(parentGone).toBe(true);
    } finally {
      // 兜底清理，避免测试失败时残留（killTree 连同孙进程一起清）
      try { native.killTree(parent.pid!); } catch { /* 已退出 */ }
    }
  }, 15000);

  it('never kills protected processes (services.exe root returns 0)', () => {
    const procs = native.processScan();
    const svc = procs.find((p) => p.name.toLowerCase() === 'services.exe');
    expect(svc).toBeDefined();
    // 根在保护名单内 → KillTree 整树拒绝，返回 0
    expect(native.killTree(svc!.pid)).toBe(0);
  });

  it('returns 0 for a non-existent pid', () => {
    expect(native.killTree(0x7ffffff0)).toBe(0);
  });
});

