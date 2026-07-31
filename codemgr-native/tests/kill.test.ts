import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import native from '../index';

describe('kill 逐 pid 结果（UX-02/04）', () => {
  it('killProcess 返回状态字符串：自身=protected / 不存在=not-found / 保护名单名=protected', () => {
    expect(native.killProcess(process.pid)).toBe('protected'); // 永不杀自身
    expect(native.killProcess(99999999)).toBe('not-found');

    const procs = native.processScan() as Array<{ pid: number; name: string }>;
    const svchost = procs.find((p) => p.name.toLowerCase() === 'svchost.exe');
    expect(svchost).toBeDefined();
    expect(native.killProcess(svchost!.pid)).toBe('protected');
  });

  it('killByPids 逐 pid 区分 killed / not-found / protected', async () => {
    // 真实子进程：确保可杀
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
    await new Promise<void>((resolve) => child.on('spawn', () => resolve()));

    const outcomes = native.killByPids([child.pid!, 99999999, process.pid]) as Array<{ pid: number; status: string }>;
    const byPid = new Map(outcomes.map((o) => [o.pid, o.status]));
    expect(byPid.get(child.pid!)).toBe('killed');
    expect(byPid.get(99999999)).toBe('not-found');
    expect(byPid.get(process.pid)).toBe('protected');

    // 子进程确实被杀
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  });
});
