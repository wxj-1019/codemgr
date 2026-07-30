# 系统启动项管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新「启动项」面板：列出 HKCU/HKLM Run 注册表项 + 启动文件夹项，HKCU 与文件夹项可逆禁用/恢复（备份键搬移 / 改后缀），HKLM 只读。

**Architecture:** main `electron/startupItems.ts`（parse/merge/plan 纯函数 TDD + deps 注入执行器）→ `startup:list`/`startup:setEnabled` 通道 → `startupStore`（乐观更新 + 失败回滚）→ `StartupPanel` 注册进 panelCatalog（workflow 组）。

**Tech Stack:** reg.exe query/execFile（无 shell）、fs.readdir/rename、zustand、Vitest。

**Spec:** `docs/superpowers/specs/2026-07-31-startup-items-design.md`

---

### Task 1: 纯逻辑（parse/merge/plan）+ 类型（TDD）

**Files:**
- Modify: `app/electron/ipc-types.ts`（StartupItem 类型 + 通道常量 + ExposedApi）
- Create: `app/electron/startupItems.ts`
- Test: `app/tests/startupItems.test.ts`

- [ ] **Step 1: ipc-types**

`IPC` 常量（`EXPORT_DATA_FILE` 后）加：

```ts
  // 启动项（子项目 G）：列出/启停系统启动项。禁用在 main 经备份键搬移/改后缀（可逆）。
  STARTUP_LIST: 'startup:list',
  STARTUP_SET_ENABLED: 'startup:setEnabled',
```

类型区加：

```ts
/** 系统启动项（子项目 G）。id 编码来源：hkcu:<value名> / hklm:<value名> / folder:<当前文件名>。 */
export interface StartupItem {
  id: string;
  name: string;
  command: string;
  source: 'hkcu-run' | 'hklm-run' | 'startup-folder';
  enabled: boolean;
}
```

`ExposedApi` 加：

```ts
  // 启动项（子项目 G）。setEnabled 返回 ''=成功，非空=错误描述（HKLM 只读 → 错误文本）。
  listStartupItems(): Promise<StartupItem[]>;
  setStartupItemEnabled(id: string, enabled: boolean): Promise<string>;
```

- [ ] **Step 2: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import {
  parseRegQueryRun, mergeStartupItems, buildTogglePlan, startupFolderDir,
  listStartupItems, setStartupItemEnabled,
  HKCU_RUN, HKLM_RUN, BACKUP_KEY, DISABLED_SUFFIX, type StartupDeps,
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
    const deps = makeDeps({
      execFile: async (_f, args) => args[0] === 'query' && args[1] === HKCU_RUN ? REG_OUT : '',
    });
    const err = await setStartupItemEnabled(deps, 'hkcu:Code', false);
    expect(err).toBe('');
    expect(deps.calls.some((c) => c.includes(`add ${BACKUP_KEY}`))).toBe(true);
    expect(deps.calls.some((c) => c.includes(`delete ${HKCU_RUN}`))).toBe(true);
    const err2 = await setStartupItemEnabled(deps, 'hkcu:Nope', false);
    expect(err2).toContain('不存在');
  });
});
```

- [ ] **Step 3: 确认失败 → Step 4: 实现** `app/electron/startupItems.ts`：

```ts
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
```

- [ ] **Step 5: PASS + Commit**

```bash
git add app/electron/ipc-types.ts app/electron/startupItems.ts app/tests/startupItems.test.ts
git commit -m "feat(app): startup items parse/merge/toggle-plan logic + executor"
```

---

### Task 2: IPC 接线

**Files:**
- Modify: `app/electron/preload.ts`、`app/electron/main.ts`、`app/src/lib/ipc.ts`

- [ ] **Step 1: preload**

```ts
  listStartupItems: () => ipcRenderer.invoke(IPC.STARTUP_LIST),
  setStartupItemEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.STARTUP_SET_ENABLED, id, enabled),
```

- [ ] **Step 2: main.ts**

import 加：`import { execFile as cpExecFile } from 'node:child_process';`（若 spawn import 行已有，并列追加）+ `import { promisify } from 'node:util';` + `import { rename } from 'node:fs/promises';` + `import { listStartupItems, setStartupItemEnabled, type StartupDeps } from './startupItems';`。

shell deps 装配（shellDeps 附近）：

```ts
// ── 启动项（子项目 G）──
const startupDeps: StartupDeps = {
  execFile: promisify(cpExecFile),
  rename: (from, to) => rename(from, to),
  readdir: (dir) => readdirSync(dir),
};

ipcMain.handle(IPC.STARTUP_LIST, async () => {
  try { return await listStartupItems(startupDeps); }
  catch (e) { console.error('startup:list failed:', e); return []; }
});

ipcMain.handle(IPC.STARTUP_SET_ENABLED, async (_evt, id: string, enabled: boolean) => {
  try { return await setStartupItemEnabled(startupDeps, String(id), !!enabled); }
  catch (e) { console.error('startup:setEnabled failed:', e); return String(e); }
});
```

- [ ] **Step 3: lib/ipc**

```ts
  listStartupItems: (...a) => invoke('listStartupItems', ...a),
  setStartupItemEnabled: (...a) => invoke('setStartupItemEnabled', ...a),
```

- [ ] **Step 4: typecheck + Commit**

```bash
git add app/electron/preload.ts app/electron/main.ts app/src/lib/ipc.ts
git commit -m "feat(app): wire startup:list/setEnabled IPC channels"
```

---

### Task 3: startupStore（TDD）

**Files:**
- Create: `app/src/store/startupStore.ts`
- Test: `app/tests/startupStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStartupStore } from '../src/store/startupStore';
import { useToastStore, __resetToastStoreForTests } from '../src/store/toastStore';
import type { StartupItem } from '../electron/ipc-types';

const item: StartupItem = { id: 'hkcu:A', name: 'A', command: 'C:\\a.exe', source: 'hkcu-run', enabled: true };

function mockApi(impl: Partial<{ listStartupItems: () => Promise<StartupItem[]>; setStartupItemEnabled: (id: string, en: boolean) => Promise<string> }>) {
  Object.defineProperty(window, 'codemgr', { value: impl, writable: true, configurable: true });
}

beforeEach(() => {
  __resetToastStoreForTests();
  useStartupStore.setState({ items: [], loading: false, error: null, toggling: new Set() });
});

describe('startupStore', () => {
  it('refresh 成功写入 items；失败进 error', async () => {
    mockApi({ listStartupItems: async () => [item] });
    await useStartupStore.getState().refresh();
    expect(useStartupStore.getState().items).toEqual([item]);
    mockApi({ listStartupItems: async () => { throw new Error('x'); } });
    await useStartupStore.getState().refresh();
    expect(useStartupStore.getState().error).toBeTruthy();
  });

  it('toggle 乐观翻转，成功保持；失败回滚并 toast', async () => {
    mockApi({
      listStartupItems: async () => [item],
      setStartupItemEnabled: async () => '',
    });
    await useStartupStore.getState().refresh();
    await useStartupStore.getState().toggle('hkcu:A');
    expect(useStartupStore.getState().items[0]!.enabled).toBe(false);

    mockApi({
      listStartupItems: async () => [item],
      setStartupItemEnabled: async () => '拒绝访问',
    });
    await useStartupStore.getState().refresh();
    await useStartupStore.getState().toggle('hkcu:A');
    expect(useStartupStore.getState().items[0]!.enabled).toBe(true); // 回滚
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('拒绝访问'))).toBe(true);
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// 启动项面板状态（子项目 G）：手动刷新（无轮询）+ 乐观启停（失败回滚 + toast）。
import { create } from 'zustand';
import type { StartupItem } from '../../electron/ipc-types';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';

interface StartupState {
  items: StartupItem[];
  loading: boolean;
  error: string | null;
  toggling: ReadonlySet<string>;
  refresh: () => Promise<void>;
  toggle: (id: string) => Promise<void>;
}

export const useStartupStore = create<StartupState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  toggling: new Set(),
  refresh: async () => {
    set({ loading: true });
    try {
      const items = await ipc.listStartupItems();
      set({ items, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  toggle: async (id) => {
    const { toggling, items } = get();
    if (toggling.has(id)) return;
    const target = items.find((x) => x.id === id);
    if (!target) return;
    // 乐观翻转；失败回滚 + toast
    set({
      toggling: new Set([...toggling, id]),
      items: items.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
    });
    try {
      const err = await ipc.setStartupItemEnabled(id, !target.enabled);
      if (err) {
        set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, enabled: target.enabled } : x)) }));
        notify.error(err);
      } else {
        await get().refresh(); // 成功后重采对齐（文件夹项 id 随后缀变化）
      }
    } catch (e) {
      set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, enabled: target.enabled } : x)) }));
      notify.error(String(e));
    } finally {
      set((s) => ({ toggling: new Set([...s.toggling].filter((x) => x !== id)) }));
    }
  },
}));
```

- [ ] **Step 4: PASS + Commit**

```bash
git add app/src/store/startupStore.ts app/tests/startupStore.test.ts
git commit -m "feat(app): startup store (manual refresh, optimistic toggle with rollback)"
```

---

### Task 4: StartupPanel + 注册 + 收口

**Files:**
- Create: `app/src/components/StartupPanel.tsx`
- Modify: `app/src/store/layoutStore.ts`（BuiltInPanelId 加 'startup'）
- Modify: `app/src/components/workspace/panelCatalog.tsx`（workflow 组注册）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: StartupPanel**

```tsx
import { useEffect } from 'react';
import { useStartupStore } from '../store/startupStore';
import { PanelActionBar } from './ui/PanelActionBar';
import { IconButton } from './ui/IconButton';
import { Badge } from './ui/Badge';
import { LoadState } from './LoadState';
import { RefreshCw } from './icons';
import type { StartupItem } from '../../electron/ipc-types';

const SOURCE_BADGE: Record<StartupItem['source'], { text: string; tone: 'accent' | 'neutral' | 'info' }> = {
  'hkcu-run': { text: '注册表·当前用户', tone: 'accent' },
  'hklm-run': { text: '注册表·系统', tone: 'neutral' },
  'startup-folder': { text: '启动文件夹', tone: 'info' },
};

/** 启动项面板（子项目 G）：手动刷新；HKCU/文件夹可启停，HKLM 只读。 */
export function StartupPanel() {
  const { items, loading, error, toggling, refresh, toggle } = useStartupStore();
  useEffect(() => { void refresh(); }, [refresh]);

  const isFirstLoad = items.length === 0 && !error;
  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="启动项"
        summary={`${items.length} 项 · ${items.filter((i) => i.enabled).length} 启用`}
        actions={<IconButton label="刷新" size="sm" onClick={() => void refresh()}><RefreshCw /></IconButton>}
      />
      {((isFirstLoad && loading) || (!!error && items.length === 0)) ? (
        <LoadState loading={loading} error={error} empty={false} emptyText="" isFirstLoad={isFirstLoad} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-base-800 text-left text-xs uppercase text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 font-medium">命令</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const src = SOURCE_BADGE[i.source];
                const readOnly = i.source === 'hklm-run';
                return (
                  <tr key={i.id} className="border-b border-base-700/50">
                    <td className="px-3 py-2 text-fg-primary">{i.name}</td>
                    <td className="px-3 py-2"><Badge tone={src.tone}>{src.text}</Badge></td>
                    <td className="max-w-[280px] truncate px-3 py-2 font-mono text-xs text-fg-muted" title={i.command}>{i.command}</td>
                    <td className="px-3 py-2 text-xs">{i.enabled ? '启用' : '已禁用'}</td>
                    <td className="px-3 py-2 text-right">
                      {readOnly ? (
                        <span className="text-xs text-fg-muted" title="系统级启动项需要管理员权限，v1 只读">只读</span>
                      ) : (
                        <button
                          disabled={toggling.has(i.id)}
                          onClick={() => void toggle(i.id)}
                          className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600 disabled:opacity-50"
                        >
                          {i.enabled ? '禁用' : '恢复'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-fg-muted">未发现启动项</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

（Badge 的 tone 联合类型以 ui/Badge 实际定义为准，若无 'neutral'/'info' 则映射到现有 tone。）

- [ ] **Step 2: layoutStore 注册**

`BuiltInPanelId` 联合加 `'startup'`；`isBuiltInPanel` 的集合同步加。

- [ ] **Step 3: panelCatalog 注册**

import StartupPanel；`BUILTIN_PANEL_CATALOG` 加：

```tsx
  startup: {
    title: '启动项',
    group: 'workflow',
    icon: <CatalogIcon label="启" />,
    renderer: () => <StartupPanel />,
  },
```

- [ ] **Step 4: 全量回归 + CHANGELOG + Commit**

CHANGELOG `[Unreleased]` 追加：

```markdown
- **启动项管理**：新「启动项」面板（workflow 组）列出 HKCU/HKLM Run 注册表项与启动文件夹项；HKCU 与文件夹项可逆禁用/恢复（备份键搬移 / `.codemgr-disabled` 后缀，不删数据），HKLM 系统级项只读。新增 `startup:list`/`startup:setEnabled` IPC 通道。
```

```bash
git add app/src/components/StartupPanel.tsx app/src/store/layoutStore.ts app/src/components/workspace/panelCatalog.tsx CHANGELOG.md
git commit -m "feat(app): startup items panel with reversible disable"
```

---

## Self-Review 记录

- Spec §3.1 模型 → Task 1 ipc-types；§3.2 禁用模型 → Task 1 plan/merge；§3.3 采集执行 → Task 1 executor + Task 2；§4 IPC → Task 1/2；§5 UI → Task 3/4；§6 测试 → Task 1/3。
- 类型一致性：`StartupItem.source` 三值在 ipc-types/merge/SOURCE_BADGE 一致；`StartupDeps` 在 Task 1 定义、Task 2 装配复用；`ToggleStep` 两 kind 与执行器分支一致。
- 风险：Badge tone 名以实际组件为准（Task 4 Step 1 已注明兜底）；`isBuiltInPanel` 若为硬编码集合需同步（Task 4 Step 2 已注明）。
