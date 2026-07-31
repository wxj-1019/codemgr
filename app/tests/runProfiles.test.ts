import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunProfile, RunState } from '../electron/ipc-types';
import { validateProfile, RUN_COMMAND_WHITELIST, RunManager } from '../electron/runProfiles';
// vitest 对 CJS 内置模块（node:child_process）的命名导入经 `default` 解析——
// mock 必须挂在 default 下才被 runProfiles.ts 的 import 命中（实验 D 验证）。
const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mockExecFile, default: { execFile: mockExecFile } }));
import { execFile } from 'node:child_process';

const valid = {
  id: '11111111-2222-3333-4444-555555555555',
  name: '前端',
  command: 'pnpm',
  args: ['dev'],
  cwd: 'E:\\repo\\app',
};

describe('RUN_COMMAND_WHITELIST', () => {
  it('contains common dev executables', () => {
    expect(RUN_COMMAND_WHITELIST.has('node')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('pnpm')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('npm')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('python')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('git')).toBe(true);
  });
  it('excludes dangerous executables', () => {
    expect(RUN_COMMAND_WHITELIST.has('calc')).toBe(false);
    expect(RUN_COMMAND_WHITELIST.has('cmd')).toBe(false);
    expect(RUN_COMMAND_WHITELIST.has('powershell')).toBe(false);
  });
});

describe('validateProfile', () => {
  it('accepts a valid profile', () => {
    const p = validateProfile(valid);
    expect(p).not.toBeNull();
    expect(p!.command).toBe('pnpm');
  });

  it('rejects non-whitelist command', () => {
    expect(validateProfile({ ...valid, command: 'calc' })).toBeNull();
  });

  it('rejects relative cwd', () => {
    expect(validateProfile({ ...valid, cwd: 'relative/path' })).toBeNull();
  });

  it('rejects non-array args', () => {
    expect(validateProfile({ ...valid, args: 'dev' as unknown as string[] })).toBeNull();
  });

  it('rejects empty name', () => {
    expect(validateProfile({ ...valid, name: '' })).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateProfile(null)).toBeNull();
    expect(validateProfile('x')).toBeNull();
  });

  it('preserves optional expectedPorts', () => {
    const p = validateProfile({ ...valid, expectedPorts: [5173, 3000] });
    expect(p!.expectedPorts).toEqual([5173, 3000]);
  });
});

describe('RunManager', () => {
  const profile: RunProfile = {
    id: '11111111-2222-3333-4444-555555555555',
    name: '前端 dev',
    command: 'pnpm',
    args: ['dev'],
    cwd: 'E:\\repo\\app',
  };
  let updates: RunState[] = [];
  let manager: RunManager;

  function fakeChild(pid = 1234) {
    const child = new EventEmitter() as unknown as ReturnType<typeof execFile>;
    (child as { pid: number }).pid = pid;
    return child;
  }

  beforeEach(() => {
    updates = [];
    manager = new RunManager({ killTree: () => 0 }, (s) => updates.push(s));
    mockExecFile.mockReset();
  });

  it('spawn error → run 置 failed 并携带错误信息，且推送更新（UX-05）', () => {
    const child = fakeChild();
    mockExecFile.mockReturnValue(child);
    const res = manager.start(profile);
    expect(res).not.toBeNull();
    const err = Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' });
    child.emit('error', err);
    const st = manager.getState(res!.runId)!;
    expect(st.status).toBe('failed');
    expect(st.error).toContain('ENOENT');
    expect(updates.map((u) => u.status)).toEqual(['failed']);
  });

  it('spawn 同步失败（无 pid）也能记录 run，pid 回退 0', () => {
    const child = new EventEmitter() as unknown as ReturnType<typeof execFile>;
    mockExecFile.mockReturnValue(child);
    const res = manager.start(profile);
    expect(res).not.toBeNull();
    expect(manager.getState(res!.runId)!.pid).toBe(0);
  });

  it('error 后跟来的 exit 不再覆盖 failed 状态（双事件守卫）', () => {
    const child = fakeChild();
    mockExecFile.mockReturnValue(child);
    const res = manager.start(profile);
    child.emit('error', new Error('boom'));
    child.emit('exit', null);
    const st = manager.getState(res!.runId)!;
    expect(st.status).toBe('failed');
    expect(st.error).toBe('boom');
  });

  it('正常 exit 仍走 exited（回归）', () => {
    const child = fakeChild();
    mockExecFile.mockReturnValue(child);
    const res = manager.start(profile);
    child.emit('exit', 0);
    const st = manager.getState(res!.runId)!;
    expect(st.status).toBe('exited');
    expect(st.exitCode).toBe(0);
  });

  it('同 profile 重试时清理旧的终态 run（防无界增长）', () => {
    const child1 = fakeChild();
    mockExecFile.mockReturnValueOnce(child1);
    const res1 = manager.start(profile);
    child1.emit('error', new Error('ENOENT'));
    expect(manager.getState(res1!.runId)!.status).toBe('failed');

    const child2 = fakeChild(5678);
    mockExecFile.mockReturnValueOnce(child2);
    const res2 = manager.start(profile);

    const states = manager.allStates();
    expect(states).toHaveLength(1);
    expect(states[0].runId).toBe(res2!.runId);
    expect(states[0].pid).toBe(5678);
    expect(manager.getState(res1!.runId)).toBeNull();
  });
});
