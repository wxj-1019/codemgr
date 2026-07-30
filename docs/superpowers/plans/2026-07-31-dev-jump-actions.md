# 开发者跳转动作闭环（Dev Jump Actions）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 进程/项目/端口三视图补齐"跳出去"动作：复制 cwd、打开文件夹/终端/编辑器、端口浏览器打开 + 端口表右键菜单。

**Architecture:** 纯逻辑编排 `app/electron/shellActions.ts`（不 import electron，依赖注入可测）+ 2 个新 IPC 通道（`shell:openTarget`/`shell:openExternalUrl`，main 侧 kind/scheme 白名单校验）+ 渲染层 `lib/shellClient.ts` 统一错误出口 + `lib/processMenu.ts`/`lib/portActions.ts` 纯菜单构建器（消灭 ProcessTable/ProjectGroupView 两处菜单重复）。

**Tech Stack:** Electron 43（shell/child_process）、React 18、Vitest、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-31-dev-jump-actions-design.md`

---

### Task 1: main 侧 shellActions 纯逻辑（TDD）

**Files:**
- Create: `app/electron/shellActions.ts`
- Test: `app/tests/shellActions.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `app/tests/shellActions.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm vitest run tests/shellActions.test.ts`
Expected: FAIL（`../electron/shellActions` 模块不存在）

- [ ] **Step 3: 实现**

创建 `app/electron/shellActions.ts`：

```ts
// shell 跳转动作（子项目 A）：纯逻辑编排，不 import electron——依赖经 ShellDeps 注入，
// 便于 vitest 直测。安全约束：kind 白名单 + path 绝对路径且存在 + url 仅 http/https，
// 渲染层只传"打开什么"，结构上无法借此构造任意命令。
import type { OpenTargetKind } from './ipc-types';

export interface SpawnPlan {
  file: string;
  args: string[];
  options: Record<string, unknown>;
}

/** child_process.spawn 返回值的最小切面（测试可伪造）。 */
export interface SpawnLike {
  on(event: 'error', cb: (err: Error) => void): void;
  unref?(): void;
}

export interface ShellDeps {
  /** electron shell.openPath：返回 '' 成功，非空为错误描述。 */
  openPath: (p: string) => Promise<string>;
  /** electron shell.openExternal。 */
  openExternal: (url: string) => Promise<void>;
  spawn: (file: string, args: string[], options: Record<string, unknown>) => SpawnLike;
  /** `where <file>` 语义：可执行名是否在 PATH。 */
  commandExists: (file: string) => Promise<boolean>;
  /** fs.existsSync 语义。 */
  exists: (p: string) => boolean;
}

const KINDS: ReadonlySet<string> = new Set(['folder', 'terminal', 'editor']);

export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** 返回 null = 合法；非空字符串 = 错误描述（直接可给 UI）。 */
export function validateTarget(
  kind: string,
  path: string,
  exists: (p: string) => boolean,
): string | null {
  if (!KINDS.has(kind)) return `未知打开类型：${kind}`;
  if (!path || !isAbsolutePath(path)) return '路径不是绝对路径';
  if (!exists(path)) return '路径不存在或不可访问';
  return null;
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 终端计划：优先 Windows Terminal（wt -d），无 wt 回退 cmd start（用 cwd 选项落目录，避开 start 的引号标题陷阱）。 */
export function buildTerminalPlan(path: string, hasWt: boolean): SpawnPlan {
  return hasWt
    ? { file: 'wt.exe', args: ['-d', path], options: { detached: true, stdio: 'ignore' } }
    : { file: 'cmd.exe', args: ['/c', 'start', 'cmd.exe'], options: { detached: true, stdio: 'ignore', cwd: path } };
}

/** 编辑器计划：VS Code。Windows 上 code 是 code.cmd，必须 shell:true（Node 负责参数 quoting）。 */
export function buildEditorPlan(path: string): SpawnPlan {
  return { file: 'code', args: [path], options: { shell: true, detached: true, stdio: 'ignore' } };
}

/** 打开目标。返回 '' = 成功，非空 = 错误描述（照 shell.openPath 语义，UI 直接展示）。 */
export async function openTarget(kind: OpenTargetKind, path: string, deps: ShellDeps): Promise<string> {
  const invalid = validateTarget(kind, path, deps.exists);
  if (invalid) return invalid;
  try {
    if (kind === 'folder') return await deps.openPath(path);
    if (kind === 'terminal') {
      const plan = buildTerminalPlan(path, await deps.commandExists('wt.exe'));
      deps.spawn(plan.file, plan.args, plan.options).unref?.();
      return '';
    }
    // editor
    if (!(await deps.commandExists('code'))) return '未检测到 VS Code（code 命令不在 PATH）';
    const plan = buildEditorPlan(path);
    deps.spawn(plan.file, plan.args, plan.options).unref?.();
    return '';
  } catch (e) {
    return String(e);
  }
}

export async function openExternalUrl(
  url: string,
  deps: Pick<ShellDeps, 'openExternal'>,
): Promise<string> {
  if (!isSafeExternalUrl(url)) return `不允许打开的 URL：${url}`;
  try {
    await deps.openExternal(url);
    return '';
  } catch (e) {
    return String(e);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && pnpm vitest run tests/shellActions.test.ts`
Expected: PASS（7 个 describe 全绿）

- [ ] **Step 5: Commit**

```bash
git add app/electron/shellActions.ts app/tests/shellActions.test.ts
git commit -m "feat(app): main-side shell jump action orchestration (validated openTarget/openExternalUrl)"
```

---

### Task 2: IPC 接线（6 处中的 4 处，无 native）

**Files:**
- Modify: `app/electron/ipc-types.ts`
- Modify: `app/electron/preload.ts`
- Modify: `app/electron/main.ts`
- Modify: `app/src/lib/ipc.ts`

- [ ] **Step 1: ipc-types.ts**

`IPC` 常量对象内（`RUN_UPDATE` 之后）追加：

```ts
  // shell 跳转动作（子项目 A）：打开文件夹/终端/编辑器 + 浏览器打开 URL。
  // kind/路径/scheme 校验全在 main（shellActions.ts），渲染层只传 kind+path/url。
  OPEN_TARGET: 'shell:openTarget',
  OPEN_EXTERNAL_URL: 'shell:openExternalUrl',
```

类型区（`RunState` 之后）追加：

```ts
/** shell 打开目标类型（子项目 A）。folder=Explorer；terminal=wt 优先回退 cmd；editor=VS Code。 */
export type OpenTargetKind = 'folder' | 'terminal' | 'editor';
```

`ExposedApi` 接口内（`onRunUpdate` 之后）追加：

```ts
  // shell 跳转动作（子项目 A）。返回 '' = 成功，非空 = 错误描述（UI 直接展示）。
  openTarget(kind: OpenTargetKind, path: string): Promise<string>;
  // 浏览器打开 URL，main 侧仅放行 http/https。
  openExternalUrl(url: string): Promise<string>;
```

- [ ] **Step 2: preload.ts**

`api` 对象内（`onRunUpdate` 之后）追加：

```ts
  openTarget: (kind: OpenTargetKind, path: string) => ipcRenderer.invoke(IPC.OPEN_TARGET, kind, path),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),
```

import 行追加 `OpenTargetKind` 类型（与 `RunState` 同一 import 语句内）。

- [ ] **Step 3: main.ts**

文件头部：electron import 中追加 `shell`；新增 `import { spawn } from 'node:child_process';`（若已有则不重复）；新增 `import { openTarget, openExternalUrl, type ShellDeps, type SpawnLike } from './shellActions';`；`OpenTargetKind` 加入 ipc-types import。

在 `FETCH_GIT_IDENTITY` handler 之后插入：

```ts
// ── shell 跳转动作（子项目 A）──
// 校验/编排全在 shellActions（纯逻辑），这里只做 electron/child_process 真实依赖装配。
const shellDeps: ShellDeps = {
  openPath: (p) => shell.openPath(p),
  openExternal: (url) => shell.openExternal(url).then(() => undefined),
  spawn: (file, args, options): SpawnLike => spawn(file, args, options),
  commandExists: (file) =>
    new Promise((resolve) => {
      const p = spawn('cmd.exe', ['/c', 'where', file], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    }),
  exists: (p) => existsSync(p),
};

ipcMain.handle(IPC.OPEN_TARGET, async (_evt, kind: OpenTargetKind, path: string) => {
  try { return await openTarget(kind, path, shellDeps); }
  catch (e) { console.error('shell:openTarget failed:', e); return String(e); }
});

ipcMain.handle(IPC.OPEN_EXTERNAL_URL, async (_evt, url: string) => {
  try { return await openExternalUrl(url, shellDeps); }
  catch (e) { console.error('shell:openExternalUrl failed:', e); return String(e); }
});
```

- [ ] **Step 4: app/src/lib/ipc.ts**

`ipc` 对象内（`onRunUpdate` 之后）追加：

```ts
  openTarget: (...a) => invoke('openTarget', ...a),
  openExternalUrl: (...a) => invoke('openExternalUrl', ...a),
```

- [ ] **Step 5: typecheck + Commit**

Run: `cd app && pnpm typecheck`
Expected: 无错误

```bash
git add app/electron/ipc-types.ts app/electron/preload.ts app/electron/main.ts app/src/lib/ipc.ts
git commit -m "feat(app): wire shell:openTarget/openExternalUrl IPC channels"
```

---

### Task 3: 渲染层 shellClient + portActions 纯逻辑（TDD）

**Files:**
- Create: `app/src/lib/shellClient.ts`
- Create: `app/src/lib/portActions.ts`
- Test: `app/tests/portActions.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `app/tests/portActions.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { browseUrlFor, buildPortMenuItems, type PortMenuHandlers } from '../src/lib/portActions';
import type { NetConnection } from '../electron/ipc-types';

const tcpListen: NetConnection = {
  protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000,
  remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 1234, processName: 'node.exe',
};

function makeHandlers(): PortMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onBrowse: (url) => calls.push(`browse:${url}`),
    onCopy: (t) => calls.push(`copy:${t}`),
    onLocate: (pid) => calls.push(`locate:${pid}`),
    onKill: (pid, name) => calls.push(`kill:${pid}:${name}`),
  };
}

describe('browseUrlFor', () => {
  it('TCP 监听 → 回环 http URL（不区分绑定地址）', () => {
    expect(browseUrlFor(tcpListen)).toBe('http://127.0.0.1:3000');
    expect(browseUrlFor({ ...tcpListen, localAddr: '::' })).toBe('http://127.0.0.1:3000');
  });
  it('UDP / 非监听 → null', () => {
    expect(browseUrlFor({ ...tcpListen, protocol: 'udp', state: '' })).toBeNull();
    expect(browseUrlFor({ ...tcpListen, state: 'ESTABLISHED' })).toBeNull();
  });
});

describe('buildPortMenuItems', () => {
  it('TCP 监听行：菜单五项，浏览器打开可用并回调 URL', () => {
    const h = makeHandlers();
    const items = buildPortMenuItems(tcpListen, h);
    expect(items.map((i) => i.label)).toEqual([
      '在浏览器打开', '定位到进程', '复制端口', '复制 PID', '结束进程',
    ]);
    expect(items[0]!.disabled).toBeFalsy();
    items[0]!.onSelect();
    expect(h.calls).toContain('browse:http://127.0.0.1:3000');
  });
  it('UDP 行：浏览器打开禁用，其余可用；进程名为空时 kill 用 PID 兜底', () => {
    const h = makeHandlers();
    const udp: NetConnection = { ...tcpListen, protocol: 'udp', state: '', processName: '' };
    const items = buildPortMenuItems(udp, h);
    expect(items[0]!.disabled).toBe(true);
    items[4]!.onSelect();
    expect(h.calls).toContain('kill:1234:PID 1234');
  });
  it('复制与定位回调参数正确', () => {
    const h = makeHandlers();
    const items = buildPortMenuItems(tcpListen, h);
    items[2]!.onSelect();
    items[3]!.onSelect();
    items[1]!.onSelect();
    expect(h.calls).toEqual(['copy:3000', 'copy:1234', 'locate:1234']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm vitest run tests/portActions.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

创建 `app/src/lib/shellClient.ts`：

```ts
// shell 跳转动作的渲染层统一出口。所有 UI 调用点走这里，
// 子项目 B（Toast）落地时只需改这一个文件即可把 alert 全量替换为 toast。
import { ipc } from './ipc';
import type { OpenTargetKind } from '../../electron/ipc-types';

export async function openTargetOrAlert(kind: OpenTargetKind, path: string): Promise<void> {
  try {
    const err = await ipc.openTarget(kind, path);
    if (err) alert(err);
  } catch (e) {
    alert(`打开失败：${String(e)}`);
  }
}

export async function openExternalUrlOrAlert(url: string): Promise<void> {
  try {
    const err = await ipc.openExternalUrl(url);
    if (err) alert(err);
  } catch (e) {
    alert(`打开失败：${String(e)}`);
  }
}

export function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => { /* blocked */ });
}
```

创建 `app/src/lib/portActions.ts`：

```ts
// 端口行动作纯逻辑：浏览器 URL 构造 + 右键菜单构建（PortTable 用）。
import type { NetConnection } from '../../electron/ipc-types';
import type { ContextMenuItem } from '../components/ContextMenu';

/** TCP 监听行 → 回环 http URL。不嗅探 https；绑定 ::/0.0.0.0 统一回 127.0.0.1。 */
export function browseUrlFor(
  conn: Pick<NetConnection, 'protocol' | 'state' | 'localPort'>,
): string | null {
  if (conn.protocol !== 'tcp' || conn.state !== 'LISTENING') return null;
  return `http://127.0.0.1:${conn.localPort}`;
}

export interface PortMenuHandlers {
  onBrowse: (url: string) => void;
  onCopy: (text: string) => void;
  onLocate: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
}

/** 端口表右键菜单：导航动作在上，danger 沉底（与进程菜单同约定）。 */
export function buildPortMenuItems(conn: NetConnection, handlers: PortMenuHandlers): ContextMenuItem[] {
  const url = browseUrlFor(conn);
  const name = conn.processName || `PID ${conn.pid}`;
  return [
    { label: '在浏览器打开', disabled: url === null, onSelect: () => { if (url) handlers.onBrowse(url); } },
    { label: '定位到进程', onSelect: () => handlers.onLocate(conn.pid) },
    { label: '复制端口', dividerBefore: true, onSelect: () => handlers.onCopy(String(conn.localPort)) },
    { label: '复制 PID', onSelect: () => handlers.onCopy(String(conn.pid)) },
    { label: '结束进程', dividerBefore: true, danger: true, onSelect: () => handlers.onKill(conn.pid, name) },
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && pnpm vitest run tests/portActions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/shellClient.ts app/src/lib/portActions.ts app/tests/portActions.test.ts
git commit -m "feat(app): port row actions (browse URL builder + context menu items) + shell client"
```

---

### Task 4: processMenu 纯逻辑（TDD）

**Files:**
- Create: `app/src/lib/processMenu.ts`
- Test: `app/tests/processMenu.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `app/tests/processMenu.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildProcessMenuItems, type ProcessMenuHandlers, type ProcessMenuTarget } from '../src/lib/processMenu';

const proc: ProcessMenuTarget = { pid: 1234, name: 'node.exe', cmdline: 'node server.js', cwd: 'C:\\proj' };

function makeHandlers(): ProcessMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onOpenTarget: (kind, path) => calls.push(`open:${kind}:${path}`),
    onCopy: (t) => calls.push(`copy:${t}`),
    onKillSingle: (pid) => calls.push(`kill:${pid}`),
    onKillTree: (pid) => calls.push(`killtree:${pid}`),
  };
}

describe('buildProcessMenuItems', () => {
  it('菜单顺序：打开三项 → 复制三项 → kill 沉底', () => {
    const items = buildProcessMenuItems(proc, { hasChildren: true }, makeHandlers());
    expect(items.map((i) => i.label)).toEqual([
      '打开所在文件夹', '在终端打开', '在编辑器打开',
      '复制命令行', '复制 PID', '复制工作目录',
      '结束进程', '结束进程树',
    ]);
    expect(items[6]!.danger).toBe(true);
    expect(items[7]!.danger).toBe(true);
  });
  it('打开动作回调 kind + cwd', () => {
    const h = makeHandlers();
    const items = buildProcessMenuItems(proc, { hasChildren: false }, h);
    items[0]!.onSelect();
    items[1]!.onSelect();
    items[2]!.onSelect();
    expect(h.calls).toEqual([
      'open:folder:C:\\proj', 'open:terminal:C:\\proj', 'open:editor:C:\\proj',
    ]);
  });
  it('无 cwd：打开三项与复制工作目录禁用', () => {
    const items = buildProcessMenuItems({ ...proc, cwd: '' }, { hasChildren: false }, makeHandlers());
    expect(items[0]!.disabled).toBe(true);
    expect(items[1]!.disabled).toBe(true);
    expect(items[2]!.disabled).toBe(true);
    expect(items[5]!.disabled).toBe(true);
    expect(items[3]!.disabled).toBeFalsy(); // 复制命令行仍可用
  });
  it('无 cmdline：复制命令行禁用', () => {
    const items = buildProcessMenuItems({ ...proc, cmdline: '' }, { hasChildren: false }, makeHandlers());
    expect(items[3]!.disabled).toBe(true);
  });
  it('结束进程树仅 hasChildren 且 pid>4 出现', () => {
    const noChild = buildProcessMenuItems(proc, { hasChildren: false }, makeHandlers());
    expect(noChild.find((i) => i.label === '结束进程树')).toBeUndefined();
    const sysProc = buildProcessMenuItems({ ...proc, pid: 4 }, { hasChildren: true }, makeHandlers());
    expect(sysProc.find((i) => i.label === '结束进程树')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm vitest run tests/processMenu.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

创建 `app/src/lib/processMenu.ts`：

```ts
// 进程右键菜单构建（ProcessTable 树视图与 ProjectGroupView 项目视图共用）。
// 此前两处各自内联定义相同菜单（复制命令行/复制 PID），此模块收敛为一处。
import type { ContextMenuItem } from '../components/ContextMenu';
import type { OpenTargetKind } from '../../electron/ipc-types';

export interface ProcessMenuTarget {
  pid: number;
  name: string;
  cmdline: string;
  cwd: string;
}

export interface ProcessMenuHandlers {
  onOpenTarget: (kind: OpenTargetKind, path: string) => void;
  onCopy: (text: string) => void;
  onKillSingle: (pid: number, name: string) => void;
  onKillTree: (pid: number, name: string) => void;
}

/**
 * 菜单约定：导航动作在上，复制居中，danger 沉底。
 * - 打开/复制 cwd 在 cwd 为空（系统进程、权限不足）时禁用。
 * - 结束进程树：树视图传 hasChildren=真实父子关系；项目视图无树信息，传 true（按 pid>4 放行）。
 */
export function buildProcessMenuItems(
  proc: ProcessMenuTarget,
  opts: { hasChildren: boolean },
  handlers: ProcessMenuHandlers,
): ContextMenuItem[] {
  const noCwd = !proc.cwd;
  return [
    { label: '打开所在文件夹', disabled: noCwd, onSelect: () => handlers.onOpenTarget('folder', proc.cwd) },
    { label: '在终端打开', disabled: noCwd, onSelect: () => handlers.onOpenTarget('terminal', proc.cwd) },
    { label: '在编辑器打开', disabled: noCwd, onSelect: () => handlers.onOpenTarget('editor', proc.cwd) },
    { label: '复制命令行', dividerBefore: true, disabled: !proc.cmdline, onSelect: () => handlers.onCopy(proc.cmdline) },
    { label: '复制 PID', onSelect: () => handlers.onCopy(String(proc.pid)) },
    { label: '复制工作目录', disabled: noCwd, onSelect: () => handlers.onCopy(proc.cwd) },
    { label: '结束进程', dividerBefore: true, danger: true, onSelect: () => handlers.onKillSingle(proc.pid, proc.name) },
    ...(opts.hasChildren && proc.pid > 4
      ? [{ label: '结束进程树', danger: true as const, onSelect: () => handlers.onKillTree(proc.pid, proc.name) }]
      : []),
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && pnpm vitest run tests/processMenu.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/processMenu.ts app/tests/processMenu.test.ts
git commit -m "feat(app): shared process context menu builder (open/copy/kill ordering)"
```

---

### Task 5: icons 门面扩充 + PortTable 右键菜单与浏览器按钮

**Files:**
- Modify: `app/src/components/icons.tsx`
- Modify: `app/src/components/PortTable.tsx`

- [ ] **Step 1: icons.tsx 追加五个图标**

`export { ... } from 'lucide-react'` 块中按字母序插入：`Code`（ChevronUp 后）、`Copy`（Code 后）、`FolderOpen`（Folder 后）、`Globe`（FolderOpen 后）、`Terminal`（Sun 后）。

- [ ] **Step 2: PortTable.tsx 改造**

import 追加：

```ts
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { IconButton } from './ui/IconButton';
import { Globe, TriangleAlert } from './icons';
import { browseUrlFor, buildPortMenuItems } from '../lib/portActions';
import { copyText, openExternalUrlOrAlert } from '../lib/shellClient';
```

（原 `TriangleAlert` import 并入新 icons 行。）

组件内 `const [focusedIdx, ...]` 之前插入菜单状态：

```tsx
  // ── 右键菜单（端口行动作：浏览器打开/定位/复制/结束）──
  const [menu, setMenu] = useState<{ x: number; y: number; conn: NetConnection } | null>(null);
  const menuItems: ContextMenuItem[] = menu
    ? buildPortMenuItems(menu.conn, {
        onBrowse: (url) => void openExternalUrlOrAlert(url),
        onCopy: copyText,
        onLocate: (pid) => onSelect(pid),
        onKill: (pid, name) => onKill(pid, name),
      })
    : [];
```

行 `<tr>` 加 `onContextMenu`：

```tsx
onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, conn: c }); }}
```

操作列「结束」按钮前插入 Globe 按钮（`browseUrl` 在 map 回调顶部 `const browseUrl = browseUrlFor(c);` 计算）：

```tsx
{browseUrl && (
  <IconButton
    label="在浏览器打开"
    size="xs"
    onClick={(e) => { e.stopPropagation(); void openExternalUrlOrAlert(browseUrl); }}
  >
    <Globe />
  </IconButton>
)}
```

组件 `</table>` 后、最外层 `</div>` 前渲染：

```tsx
      <ContextMenu open={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0} items={menuItems} onClose={() => setMenu(null)} />
```

- [ ] **Step 3: typecheck + 既有端口测试不回归**

Run: `cd app && pnpm typecheck && pnpm vitest run tests/portActions.test.ts tests/portLabels.test.ts`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/components/icons.tsx app/src/components/PortTable.tsx
git commit -m "feat(app): port table context menu + open-in-browser action"
```

---

### Task 6: ProcessTable / ProjectGroupView 菜单切换到共享构建器

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`（menuItems 构造处，约 455-462 行）
- Modify: `app/src/components/ProjectGroupView.tsx`（menuItems 构造处，约 248-256 行）

- [ ] **Step 1: ProcessTable.tsx**

menuItems 定义替换为：

```tsx
  // 菜单项由共享构建器生成（与 ProjectGroupView 一致）：打开三项 → 复制三项 → kill 沉底
  const menuItems: ContextMenuItem[] = menu ? buildProcessMenuItems(
    menu.proc,
    { hasChildren: childrenParentSet.has(menu.proc.pid) },
    {
      onOpenTarget: (kind, path) => void openTargetOrAlert(kind, path),
      onCopy: copyText,
      onKillSingle,
      onKillTree,
    },
  ) : [];
```

import 追加 `import { buildProcessMenuItems } from '../lib/processMenu';`、`import { copyText, openTargetOrAlert } from '../lib/shellClient';`；删除组件内原 `copyText` 局部定义（改用 shellClient 的）。

注意：原菜单 kill 项在前、复制项在后，新顺序为打开→复制→kill，测试断言如有依赖菜单顺序需同步更新。

- [ ] **Step 2: ProjectGroupView.tsx**

menuItems 定义替换为：

```tsx
  // 与 ProcessTable 共用构建器；项目视图无树信息，hasChildren 传 true（按 pid>4 放行）
  const menuItems: ContextMenuItem[] = menu ? buildProcessMenuItems(
    menu.proc,
    { hasChildren: true },
    {
      onOpenTarget: (kind, path) => void openTargetOrAlert(kind, path),
      onCopy: copyText,
      onKillSingle,
      onKillTree,
    },
  ) : [];
```

同样替换 import，删除局部 `copyText`。

- [ ] **Step 3: 全量测试 + typecheck**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: 全 PASS（如有断言旧菜单顺序/项数的用例，更新为构建器契约）

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ProcessTable.tsx app/src/components/ProjectGroupView.tsx app/tests
git commit -m "refactor(app): process context menus use shared builder, add open/copy-cwd actions"
```

---

### Task 7: 详情侧栏 cwd 动作行

**Files:**
- Modify: `app/src/components/ProcessDetailSidebar.tsx`

- [ ] **Step 1: 加动作行**

import 追加：`import { IconButton } from './ui/IconButton';`、`import { Copy, FolderOpen, Terminal, Code } from './icons';`、`import { copyText, openTargetOrAlert } from '../lib/shellClient';`

组件内派生（放在 `preciseCwd` 定义之后）：

```tsx
  // 动作行用 cwd：精确优先，回退启发式（与 Git 身份解析同一取值顺序）
  const activeCwd = preciseCwd ?? proc.cwd;
```

「工作目录」`<div>` 内、状态块 `</div>` 之后追加：

```tsx
            {activeCwd && (
              <div className="mt-1 flex items-center gap-1">
                <IconButton label="复制工作目录" size="xs" onClick={() => copyText(activeCwd)}><Copy /></IconButton>
                <IconButton label="打开所在文件夹" size="xs" onClick={() => void openTargetOrAlert('folder', activeCwd)}><FolderOpen /></IconButton>
                <IconButton label="在终端打开" size="xs" onClick={() => void openTargetOrAlert('terminal', activeCwd)}><Terminal /></IconButton>
                <IconButton label="在编辑器打开" size="xs" onClick={() => void openTargetOrAlert('editor', activeCwd)}><Code /></IconButton>
              </div>
            )}
```

- [ ] **Step 2: typecheck + Commit**

Run: `cd app && pnpm typecheck`
Expected: 无错误

```bash
git add app/src/components/ProcessDetailSidebar.tsx
git commit -m "feat(app): detail sidebar cwd action row (copy/folder/terminal/editor)"
```

---

### Task 8: 项目分组行打开按钮

**Files:**
- Modify: `app/src/components/ProjectGroupView.tsx`（GroupRow，约 93-101 行操作单元格）

- [ ] **Step 1: GroupRow 操作格加三个 IconButton**

import 追加：`import { IconButton } from './ui/IconButton';`、`import { FolderOpen, Terminal, Code } from './icons';`（`openTargetOrAlert`/`copyText` 在 Task 6 已引入）。

GroupRow「结束本组」按钮前插入：

```tsx
          <span className="mr-1 inline-flex items-center gap-0.5 align-middle">
            <IconButton label="打开项目文件夹" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrAlert('folder', dir)}><FolderOpen /></IconButton>
            <IconButton label="在项目目录打开终端" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrAlert('terminal', dir)}><Terminal /></IconButton>
            <IconButton label="在编辑器打开项目" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrAlert('editor', dir)}><Code /></IconButton>
          </span>
```

- [ ] **Step 2: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: 全 PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/components/ProjectGroupView.tsx
git commit -m "feat(app): project group row open actions (folder/terminal/editor)"
```

---

### Task 9: 收口（全量验证 + CHANGELOG）

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 全量回归**

Run: `cd app && pnpm vitest run && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 2: CHANGELOG**

在 `CHANGELOG.md` 顶部 Unreleased/新版本节追加：

```markdown
- 开发者跳转动作闭环：进程右键菜单/详情侧栏/项目分组行新增「打开所在文件夹 / 在终端打开 / 在编辑器打开（VS Code）/ 复制工作目录」；端口表新增右键菜单（在浏览器打开/定位到进程/复制端口/复制 PID/结束进程）与 TCP 监听行「在浏览器打开」按钮。shell 动作经 main 侧白名单校验（kind/绝对路径/http(s) scheme），渲染层不可构造任意命令。
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for dev jump actions"
```

---

## Self-Review 记录

- Spec §3 两通道 → Task 1/2 覆盖；§4 main 实现 → Task 1/2；§5.1 侧栏 → Task 7；§5.2 进程菜单 → Task 4/6；§5.3 端口表 → Task 3/5；§5.4 分组行 → Task 8；§6 错误反馈（alert 暂用，B 替换）→ shellClient 单出口（Task 3）；§7 测试 → Task 1/3/4 + Task 9 全量回归。
- 类型一致性：`OpenTargetKind` 在 ipc-types 定义（Task 2），shellActions/processMenu/shellClient 均从 ipc-types import；`SpawnLike`/`ShellDeps` 仅在 shellActions 定义，main.ts 装配时复用。`browseUrlFor`/`buildPortMenuItems` 签名在 Task 3 定义、Task 5 使用，一致。
- 风险：ProcessTable/PGV 现有测试若断言旧菜单项（顺序/数量）会在 Task 6 红——按构建器契约更新用例，属预期内改动。
