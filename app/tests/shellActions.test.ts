import { describe, it, expect, vi } from 'vitest';
import {
  validateTarget, isAbsolutePath, isSafeExternalUrl,
  buildTerminalPlan, buildEditorPlan, openTarget, openExternalUrl,
  type ShellDeps, type SpawnLike,
} from '../electron/shellActions';

const existsTrue = () => true;

function makeDeps(overrides: Partial<ShellDeps> = {}): ShellDeps & { spawned: { file: string; args: string[] }[] } {
  const spawned: { file: string; args: string[] }[] = [];
  const spawn: ShellDeps['spawn'] = (file, args) => {
    spawned.push({ file, args });
    const s: SpawnLike = { on: () => {}, unref: () => {} };
    return s;
  };
  return {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    spawn,
    commandExists: async () => false,
    exists: existsTrue,
    spawned,
    ...overrides,
  };
}

describe('isAbsolutePath', () => {
  it('接受盘符与 UNC 路径', () => {
    expect(isAbsolutePath('C:\\foo\\bar')).toBe(true);
    expect(isAbsolutePath('D:/x')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
  });
  it('拒绝相对路径与空串', () => {
    expect(isAbsolutePath('foo\\bar')).toBe(false);
    expect(isAbsolutePath('./x')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
  });
});

describe('validateTarget', () => {
  it('拒绝未知 kind', () => {
    expect(validateTarget('hack', 'C:\\x', existsTrue)).toContain('未知打开类型');
  });
  it('拒绝相对路径与不存在的路径', () => {
    expect(validateTarget('folder', 'rel\\path', existsTrue)).toBe('路径不是绝对路径');
    expect(validateTarget('folder', 'C:\\nope', () => false)).toBe('路径不存在或不可访问');
  });
  it('合法输入返回 null', () => {
    expect(validateTarget('terminal', 'C:\\x', existsTrue)).toBeNull();
  });
});

describe('isSafeExternalUrl', () => {
  it('仅放行 http/https', () => {
    expect(isSafeExternalUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('file:///C:/x')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});

describe('buildTerminalPlan / buildEditorPlan', () => {
  it('有 wt 时用 wt.exe -d，无 wt 时回退 cmd start 并以 cwd 落目录', () => {
    const wt = buildTerminalPlan('C:\\proj', true);
    expect(wt.file).toBe('wt.exe');
    expect(wt.args).toEqual(['-d', 'C:\\proj']);
    const cmd = buildTerminalPlan('C:\\proj', false);
    expect(cmd.file).toBe('cmd.exe');
    expect(cmd.args).toEqual(['/c', 'start', 'cmd.exe']);
    expect(cmd.options.cwd).toBe('C:\\proj');
  });
  it('editor 计划走 code + shell:true', () => {
    const p = buildEditorPlan('C:\\proj');
    expect(p.file).toBe('code');
    expect(p.args).toEqual(['C:\\proj']);
    expect(p.options.shell).toBe(true);
  });
});

describe('openTarget', () => {
  it('非法输入短路，不触达 spawn/openPath', async () => {
    const deps = makeDeps();
    const err = await openTarget('folder', 'rel', { ...deps, exists: () => true });
    expect(err).toBe('路径不是绝对路径');
    expect(deps.spawned).toHaveLength(0);
    expect(deps.openPath).not.toHaveBeenCalled();
  });
  it('folder 透传 openPath 结果', async () => {
    const deps = makeDeps({ openPath: vi.fn(async () => '拒绝访问') });
    expect(await openTarget('folder', 'C:\\x', deps)).toBe('拒绝访问');
    expect(deps.openPath).toHaveBeenCalledWith('C:\\x');
  });
  it('terminal 有 wt 用 wt，无 wt 回退 cmd', async () => {
    const withWt = makeDeps({ commandExists: async () => true });
    expect(await openTarget('terminal', 'C:\\x', withWt)).toBe('');
    expect(withWt.spawned[0]!.file).toBe('wt.exe');
    const noWt = makeDeps({ commandExists: async () => false });
    expect(await openTarget('terminal', 'C:\\x', noWt)).toBe('');
    expect(noWt.spawned[0]!.file).toBe('cmd.exe');
  });
  it('editor 无 code 命令时返回明确错误且不 spawn', async () => {
    const deps = makeDeps({ commandExists: async () => false });
    expect(await openTarget('editor', 'C:\\x', deps)).toContain('VS Code');
    expect(deps.spawned).toHaveLength(0);
  });
  it('editor 有 code 时 spawn 并返回空串', async () => {
    const deps = makeDeps({ commandExists: async () => true });
    expect(await openTarget('editor', 'C:\\x', deps)).toBe('');
    expect(deps.spawned[0]!.file).toBe('code');
  });
});

describe('openExternalUrl', () => {
  it('拒绝非 http/https，不触达 openExternal', async () => {
    const deps = makeDeps();
    const err = await openExternalUrl('file:///etc/passwd', deps);
    expect(err).toContain('不允许');
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it('合法 url 打开并返回空串', async () => {
    const deps = makeDeps();
    expect(await openExternalUrl('http://127.0.0.1:3000', deps)).toBe('');
    expect(deps.openExternal).toHaveBeenCalledWith('http://127.0.0.1:3000');
  });
});
