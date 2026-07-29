import { describe, it, expect } from 'vitest';
import { maskEnvVars, buildDiagnostic } from '../src/lib/diagnostic';
import type { ProcessInfo, NetConnection, GitIdentity } from '../electron/ipc-types';

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 100, ppid: 50, name: 'node.exe', cmdline: 'vite --host', cwd: 'E:\\repo\\app',
  kernelTimeMs: 1000, userTimeMs: 2000, workingSetBytes: 186 * 1024 * 1024,
  createTimeMs: Date.now() - 600000, threadCount: 12, handleCount: 340, ...over,
});

describe('maskEnvVars', () => {
  it('masks all values, never leaks original', () => {
    const masked = maskEnvVars({ PATH: '/usr/bin', NODE_ENV: 'development', API_KEY: 'sk-12345' });
    const map = new Map(masked);
    expect(map.get('NODE_ENV')).toBe('***');
    expect(map.get('API_KEY')).toBe('[REDACTED]');
    expect(masked.some(([, v]) => v.includes('development') || v.includes('sk-12345'))).toBe(false);
  });

  it('marks sensitive keys (token/secret/password/key/auth/cookie) as [REDACTED]', () => {
    const masked = maskEnvVars({
      TOKEN: 'x', MY_SECRET: 'x', PASSWORD: 'x', DB_KEY: 'x', AUTH: 'x', COOKIE: 'x', API_KEY: 'x',
    });
    for (const [, v] of masked) expect(v).toBe('[REDACTED]');
  });

  it('marks ordinary keys as ***', () => {
    const masked = maskEnvVars({ PATH: '/usr/bin', HOME: '/home', PORT: '3000' });
    for (const [, v] of masked) expect(v).toBe('***');
  });

  it('sorts keys alphabetically', () => {
    const masked = maskEnvVars({ ZEBRA: '1', ALPHA: '2', MIKE: '3' });
    expect(masked.map(([k]) => k)).toEqual(['ALPHA', 'MIKE', 'ZEBRA']);
  });
});

describe('buildDiagnostic', () => {
  const baseInput = {
    proc: proc(),
    cpuPercent: 2.3,
    preciseCwd: 'E:\\repo\\app',
    gitIdentity: { gitRoot: 'E:/repo', commonDir: 'E:/repo/.git', branch: 'feat/login', head: 'refs/heads/feat/login', detached: false, isWorktree: false } as GitIdentity,
    envVars: { PATH: '/bin', NODE_ENV: 'dev', API_KEY: 'secret' },
    connections: [
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 5173, remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 100, processName: 'node.exe' },
    ] as NetConnection[],
    parentChain: [proc({ pid: 50, ppid: 40, name: 'codex.exe' }), proc({ pid: 40, ppid: 30, name: 'explorer.exe' })],
    staleAt: null,
    codeMgrVersion: '2.3',
  };

  it('includes all sections', () => {
    const out = buildDiagnostic(baseInput);
    expect(out).toContain('node.exe');
    expect(out).toContain('PID 100');
    expect(out).toContain('vite --host');
    expect(out).toContain('feat/login');
    expect(out).toContain('5173');
    expect(out).toContain('codex.exe');
    expect(out).toContain('API_KEY=[REDACTED]');
  });

  it('shows non-git when gitIdentity is null', () => {
    const out = buildDiagnostic({ ...baseInput, gitIdentity: null });
    expect(out).toContain('非 Git 仓库');
  });

  it('omits Git section when gitIdentity undefined (not resolved)', () => {
    const out = buildDiagnostic({ ...baseInput, gitIdentity: undefined });
    expect(out.match(/## Git/)).toBeNull();
  });

  it('shows env as "(未读取)" when envVars is null', () => {
    const out = buildDiagnostic({ ...baseInput, envVars: null });
    expect(out).toContain('（未读取）');
  });

  it('shows "无监听端口" when no listening ports', () => {
    const out = buildDiagnostic({ ...baseInput, connections: [] });
    expect(out).toContain('无监听端口');
  });

  it('marks stale data when staleAt set', () => {
    const out = buildDiagnostic({ ...baseInput, staleAt: Date.now() - 30000 });
    expect(out).toContain('陈旧');
  });

  it('never leaks env original values', () => {
    const out = buildDiagnostic(baseInput);
    expect(out).not.toContain('secret');
    expect(out).not.toContain('/bin');
    expect(out).not.toContain('development');
  });
});
