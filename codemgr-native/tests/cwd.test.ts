import { describe, it, expect } from 'vitest';
import native from '../index';
import { resolve } from 'path';

describe('readProcessCwd', () => {
  it('reads cwd of the current process', () => {
    const cwd = native.readProcessCwd(process.pid);
    expect(typeof cwd).toBe('string');
    expect(cwd.length).toBeGreaterThan(0);
    // 两者都规范化为绝对路径再比对（process.cwd() 已是真实大小写，native 读 PEB）
    expect(resolve(cwd).toLowerCase()).toBe(resolve(process.cwd()).toLowerCase());
  });

  it('returns a path without \\??\\ NT prefix', () => {
    const cwd = native.readProcessCwd(process.pid);
    expect(cwd.startsWith('\\??\\')).toBe(false);
    expect(cwd.startsWith('\\\\?\\')).toBe(false);
  });

  it('throws for a non-existent pid', () => {
    expect(() => native.readProcessCwd(0x7ffffff0)).toThrow();
  });

  it('throws for a protected system process (pid 4)', () => {
    // System 进程：PROCESS_VM_READ 打开必 ACCESS_DENIED，锁定"系统进程→抛错→上层降级"链路
    expect(() => native.readProcessCwd(4)).toThrow();
  });
});
