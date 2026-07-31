// 启动项采集/启停（子项目 G）。纯逻辑（parse/merge/plan）与执行分离：deps 注入便于 TDD。
import path from 'node:path';
import type { StartupItem } from './ipc-types';

export const HKCU_RUN = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
export const HKLM_RUN = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
export const BACKUP_KEY = 'HKCU\\SOFTWARE\\CodeMgr\\DisabledStartup';
export const DISABLED_SUFFIX = '.codemgr-disabled';

/** 当前用户启动文件夹（shell:startup）。 */
export function startupFolderDir(appData = process.env.APPDATA ?? ''): string {
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

/** reg query 输出解析：4 空格分列，仅取 REG_SZ/REG_EXPAND_SZ。 */
export function parseRegQueryRun(output: string): { name: string; command: string }[] {
  const items: { name: string; command: string }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^ {4}(\S(?:.*?\S)?) {4}(?:REG_SZ|REG_EXPAND_SZ) {4}(.*)$/.exec(line);
    if (m) items.push({ name: m[1]!, command: m[2]! });
  }
  return items;
}

/** 合并三键 + 文件夹（enabled 优先去重；文件夹按 .codemgr-disabled 后缀判禁用）。 */
export function mergeStartupItems(input: {
  hkcuRun: { name: string; command: string }[];
  hklmRun: { name: string; command: string }[];
  backup: { name: string; command: string }[];
  folderFiles: string[];
  folderDir: string;
}): StartupItem[] {
  const out: StartupItem[] = [];
  const seenHkcu = new Set<string>();
  for (const v of input.hkcuRun) {
    seenHkcu.add(v.name);
    out.push({ id: `hkcu:${v.name}`, name: v.name, command: v.command, source: 'hkcu-run', enabled: true });
  }
  for (const v of input.backup) {
    const orig = v.name.startsWith('hkcu:') ? v.name.slice(5) : v.name;
    if (seenHkcu.has(orig)) continue;
    out.push({ id: `hkcu:${orig}`, name: orig, command: v.command, source: 'hkcu-run', enabled: false });
  }
  for (const v of input.hklmRun) {
    out.push({ id: `hklm:${v.name}`, name: v.name, command: v.command, source: 'hklm-run', enabled: true });
  }
  for (const f of input.folderFiles) {
    const disabled = f.endsWith(DISABLED_SUFFIX);
    out.push({
      id: `folder:${f}`,
      name: disabled ? f.slice(0, -DISABLED_SUFFIX.length) : f,
      command: path.join(input.folderDir, f),
      source: 'startup-folder', enabled: !disabled,
    });
  }
  return out;
}

export type ToggleStep =
  | { kind: 'reg'; args: string[] }
  | { kind: 'rename'; from: string; to: string };

/** 启停计划（纯函数）。HKLM 只读 → 空计划。 */
export function buildTogglePlan(item: StartupItem, enable: boolean, folderDir: string): ToggleStep[] {
  if (item.source === 'hklm-run') return [];
  if (item.source === 'startup-folder') {
    return enable
      ? [{ kind: 'rename', from: item.command, to: path.join(folderDir, item.name) }]
      : [{ kind: 'rename', from: item.command, to: item.command + DISABLED_SUFFIX }];
  }
  const backupName = `hkcu:${item.name}`;
  return enable
    ? [
        { kind: 'reg', args: ['add', HKCU_RUN, '/v', item.name, '/t', 'REG_SZ', '/d', item.command, '/f'] },
        { kind: 'reg', args: ['delete', BACKUP_KEY, '/v', backupName, '/f'] },
      ]
    : [
        { kind: 'reg', args: ['add', BACKUP_KEY, '/v', backupName, '/t', 'REG_SZ', '/d', item.command, '/f'] },
        { kind: 'reg', args: ['delete', HKCU_RUN, '/v', item.name, '/f'] },
      ];
}

export interface StartupDeps {
  execFile: (file: string, args: string[]) => Promise<string>;
  rename: (from: string, to: string) => Promise<void>;
  readdir: (dir: string) => Promise<string[]>;
}

/** 采集全量启动项；单源失败（如备份键不存在/HKLM 权限）降级为该源为空。 */
export async function listStartupItems(deps: StartupDeps): Promise<StartupItem[]> {
  const query = async (key: string) => {
    try { return parseRegQueryRun(await deps.execFile('reg.exe', ['query', key])); }
    catch { return []; }
  };
  const folderDir = startupFolderDir();
  const [hkcuRun, hklmRun, backup] = await Promise.all([query(HKCU_RUN), query(HKLM_RUN), query(BACKUP_KEY)]);
  let folderFiles: string[] = [];
  try { folderFiles = await deps.readdir(folderDir); } catch { /* 文件夹不存在 */ }
  return mergeStartupItems({ hkcuRun, hklmRun, backup, folderFiles, folderDir });
}

/** 启停执行：重新采集定位 item → 计划逐步执行。返回 ''=成功，非空=错误描述。 */
export async function setStartupItemEnabled(deps: StartupDeps, id: string, enable: boolean): Promise<string> {
  try {
    const item = (await listStartupItems(deps)).find((x) => x.id === id);
    if (!item) return '启动项不存在或已变化，请刷新';
    const steps = buildTogglePlan(item, enable, startupFolderDir());
    if (steps.length === 0) return '系统级启动项需要管理员权限，v1 只读';
    for (const s of steps) {
      if (s.kind === 'reg') await deps.execFile('reg.exe', s.args);
      else await deps.rename(s.from, s.to);
    }
    return '';
  } catch (e) {
    return String(e);
  }
}
