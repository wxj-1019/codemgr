import { describe, it, expect } from 'vitest';
import {
  parseRegQueryRun, mergeStartupItems, buildTogglePlan,
  listStartupItems, setStartupItemEnabled,
  HKCU_RUN, BACKUP_KEY, DISABLED_SUFFIX, type StartupDeps,
} from '../electron/startupItems';

const REG_OUT = `\r\nHKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\r\n\r\n    Code    REG_SZ    "C:\\Users\\x\\Code.exe" --flag\r\n    My App    REG_SZ    C:\\Tools\\app.exe\r\n    OneDriveSetup    REG_EXPAND_SZ    %LOCALAPPDATA%\\x.exe\r\n\r\n`;

describe('parseRegQueryRun', () => {
  it('解析常规与带空格名，REG_SZ/REG_EXPAND_SZ 都收', () => {
    expect(parseRegQueryRun(REG_OUT)).toEqual([
      { name: 'Code', command: '"C:\\Users\\x\\Code.exe" --flag' },
      { name: 'My App', command: 'C:\\Tools\\app.exe' },
      { name: 'OneDriveSetup', command: '%LOCALAPPDATA%\\x.exe' },
    ]);
  });
  it('空输出 → 空数组', () => {
    expect(parseRegQueryRun('')).toEqual([]);
  });
});

describe('mergeStartupItems', () => {
  it('合并三源，同名 enabled 优先，文件夹后缀判禁用', () => {
    const items = mergeStartupItems({
      hkcuRun: [{ name: 'A', command: 'C:\\a.exe' }],
      hklmRun: [{ name: 'B', command: 'C:\\b.exe' }],
      backup: [{ name: 'hkcu:A', command: 'C:\\a.exe' }, { name: 'hkcu:C', command: 'C:\\c.exe' }],
      folderFiles: ['x.lnk', 'y.bat' + DISABLED_SUFFIX],
      folderDir: 'D:\\startup',
    });
    expect(items).toEqual([
      { id: 'hkcu:A', name: 'A', command: 'C:\\a.exe', source: 'hkcu-run', enabled: true },
      { id: 'hkcu:C', name: 'C', command: 'C:\\c.exe', source: 'hkcu-run', enabled: false },
      { id: 'hklm:B', name: 'B', command: 'C:\\b.exe', source: 'hklm-run', enabled: true },
      { id: 'folder:x.lnk', name: 'x.lnk', command: 'D:\\startup\\x.lnk', source: 'startup-folder', enabled: true },
      { id: 'folder:y.bat' + DISABLED_SUFFIX, name: 'y.bat', command: 'D:\\startup\\y.bat' + DISABLED_SUFFIX, source: 'startup-folder', enabled: false },
    ]);
  });
});

describe('buildTogglePlan', () => {
  const dir = 'D:\\startup';
  it('hkcu 禁用：先写备份键再删原值', () => {
    const item = { id: 'hkcu:A', name: 'A', command: 'C:\\a.exe', source: 'hkcu-run' as const, enabled: true };
    expect(buildTogglePlan(item, false, dir)).toEqual([
      { kind: 'reg', args: ['add', BACKUP_KEY, '/v', 'hkcu:A', '/t', 'REG_SZ', '/d', 'C:\\a.exe', '/f'] },
      { kind: 'reg', args: ['delete', HKCU_RUN, '/v', 'A', '/f'] },
    ]);
  });
  it('hkcu 恢复：先写回原值再删备份', () => {
    const item = { id: 'hkcu:A', name: 'A', command: 'C:\\a.exe', source: 'hkcu-run' as const, enabled: false };
    expect(buildTogglePlan(item, true, dir)).toEqual([
      { kind: 'reg', args: ['add', HKCU_RUN, '/v', 'A', '/t', 'REG_SZ', '/d', 'C:\\a.exe', '/f'] },
      { kind: 'reg', args: ['delete', BACKUP_KEY, '/v', 'hkcu:A', '/f'] },
    ]);
  });
  it('folder：rename 加/去后缀', () => {
    const on = { id: 'folder:x.lnk', name: 'x.lnk', command: dir + '\\x.lnk', source: 'startup-folder' as const, enabled: true };
    expect(buildTogglePlan(on, false, dir)).toEqual([
      { kind: 'rename', from: dir + '\\x.lnk', to: dir + '\\x.lnk' + DISABLED_SUFFIX },
    ]);
    const off = { ...on, id: 'folder:x.lnk' + DISABLED_SUFFIX, command: dir + '\\x.lnk' + DISABLED_SUFFIX, enabled: false };
    expect(buildTogglePlan(off, true, dir)).toEqual([
      { kind: 'rename', from: dir + '\\x.lnk' + DISABLED_SUFFIX, to: dir + '\\x.lnk' },
    ]);
  });
  it('hklm 只读 → 空计划', () => {
    const item = { id: 'hklm:B', name: 'B', command: 'C:\\b.exe', source: 'hklm-run' as const, enabled: true };
    expect(buildTogglePlan(item, false, dir)).toEqual([]);
  });
});

describe('listStartupItems / setStartupItemEnabled（fake deps）', () => {
  function makeDeps(overrides: Partial<StartupDeps> = {}): StartupDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      execFile: async (file, args) => { calls.push(`${file} ${args.join(' ')}`); return ''; },
      rename: async (from, to) => { calls.push(`rename ${from} -> ${to}`); },
      readdir: async () => [],
      ...overrides,
    };
  }

  it('reg query 失败源降级为空，不拖垮整体', async () => {
    const deps = makeDeps({
      execFile: async (_f, args) => {
        if (args[1] === HKCU_RUN) return REG_OUT;
        throw new Error('access denied');
      },
    });
    const items = await listStartupItems(deps);
    expect(items.map((i) => i.name)).toEqual(['Code', 'My App', 'OneDriveSetup']);
  });

  it('toggle 按计划顺序执行；未知 id 报错不执行', async () => {
    const deps = makeDeps();
    const recording = deps.execFile; // 包装而非替换：保留 calls 记录
    deps.execFile = async (f, args) => {
      await recording(f, args);
      return args[0] === 'query' && args[1] === HKCU_RUN ? REG_OUT : '';
    };
    const err = await setStartupItemEnabled(deps, 'hkcu:Code', false);
    expect(err).toBe('');
    expect(deps.calls.some((c) => c.includes(`add ${BACKUP_KEY}`))).toBe(true);
    expect(deps.calls.some((c) => c.includes(`delete ${HKCU_RUN}`))).toBe(true);
    const err2 = await setStartupItemEnabled(deps, 'hkcu:Nope', false);
    expect(err2).toContain('不存在');
  });
});
