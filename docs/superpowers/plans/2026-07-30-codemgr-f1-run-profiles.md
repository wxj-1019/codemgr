# CodeMgr F1 — Run Profiles + 受控启动/停止 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** main 进程受控 spawn/stop/restart 开发服务（白名单 command + execFile 无 shell），profile 持久化，run 状态事件推送，RunProfilesPanel UI。

**Architecture:** runProfiles.ts 封装 main 域逻辑（profile 文件 IO + spawn + Map<runId,ChildProcess> 状态 + killTree 停止）。validateProfile 纯函数 TDD（白名单 + schema）。IPC 7 通道（list/save/delete/start/stop/restart + RUN_UPDATE 事件）。渲染层 store + hook + Panel + Editor。native 零改动（spawn 是 Node，killTree 复用）。

**Tech Stack:** Node child_process（execFile）+ Electron IPC + React 18 + TypeScript + Zustand + Vitest。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-f1-run-profiles.md`

**分支:** `feat/f1-run-profiles`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新建 main 逻辑 | `app/electron/runProfiles.ts` | RunManager 类（spawn/stop/restart + Map 状态）+ validateProfile 纯函数 + 文件 IO |
| 类型 | `app/electron/ipc-types.ts` | RunProfile/RunState + RUN_COMMAND_WHITELIST + IPC 通道 + ExposedApi |
| main handler | `app/electron/main.ts` | 注册 7 handlers + RunManager 实例 + RUN_UPDATE 事件发送 |
| preload | `app/electron/preload.ts` | start/stop/restart/list/save/delete + onRunUpdate 事件 |
| 渲染封装 | `app/src/lib/ipc.ts` | 薄封装 |
| store | `app/src/store/runProfileStore.ts`（新建） | profiles + runs |
| hook | `app/src/hooks/useRunProfiles.ts`（新建） | list + 订阅 onRunUpdate |
| 组件 | `app/src/components/RunProfilesPanel.tsx`（新建） | 列表 + 启停按钮 |
| 组件 | `app/src/components/RunProfileEditor.tsx`（新建） | 增删编辑器 |
| mosaic | `app/src/store/layoutStore.ts` + `app/src/App.tsx` | 注册 'run-profiles' 面板 |
| mock | `app/tests/setup.ts` | 补 run profile mock |
| 测试 | `app/tests/runProfiles.test.ts`（新建） | validateProfile TDD |

---

## Task 1: validateProfile 纯函数（TDD）

> F1 的安全核心：白名单 + schema 校验。纯函数，可 TDD。

**Files:**
- Create: `app/electron/runProfiles.ts`
- Test: `app/tests/runProfiles.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `app/tests/runProfiles.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { validateProfile, RUN_COMMAND_WHITELIST } from '../electron/runProfiles';

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
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/runProfiles.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 validateProfile + 白名单**

新建 `app/electron/runProfiles.ts`：

```ts
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunProfile, RunState } from './ipc-types';

/** 允许的可执行名白名单（F1 安全模型）。spawn 用 execFile 无 shell，args 数组传。 */
export const RUN_COMMAND_WHITELIST: ReadonlySet<string> = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'py', 'git',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验 profile schema（F1 安全核心）。非白名单 command / 非绝对 cwd / 坏 args → null。
 * 纯函数，无副作用，可 TDD。
 */
export function validateProfile(x: unknown): RunProfile | null {
  if (x == null || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return null;
  if (typeof o.name !== 'string' || o.name.trim() === '') return null;
  if (typeof o.command !== 'string' || !RUN_COMMAND_WHITELIST.has(o.command)) return null;
  if (!Array.isArray(o.args) || o.args.some((a) => typeof a !== 'string')) return null;
  if (typeof o.cwd !== 'string' || !path.isAbsolute(o.cwd)) return null;
  const profile: RunProfile = {
    id: o.id,
    name: o.name,
    command: o.command,
    args: o.args as string[],
    cwd: o.cwd,
  };
  if (Array.isArray(o.expectedPorts) && o.expectedPorts.every((p) => typeof p === 'number')) {
    profile.expectedPorts = o.expectedPorts as number[];
  }
  return profile;
}

// ── RunManager（main 运行时，非纯函数；封装 spawn/stop/restart + 状态）──

export class RunManager {
  private runs = new Map<string, { child: ReturnType<typeof execFile>; state: RunState }>();
  private native: { killTree: (pid: number) => number };
  private onUpdate: (state: RunState) => void;

  constructor(native: { killTree: (pid: number) => number }, onUpdate: (state: RunState) => void) {
    this.native = native;
    this.onUpdate = onUpdate;
  }

  start(profile: RunProfile): { runId: string; pid: number } | null {
    try {
      const runId = randomUUID();
      const child = execFile(profile.command, profile.args, {
        cwd: profile.cwd,
        shell: false,           // 关键：不经 shell，args 数组直接传，无注入面
        windowsHide: false,
      });
      const pid = child.pid!;
      const state: RunState = {
        runId, profileId: profile.id, pid, status: 'running', exitCode: null, startedAt: Date.now(),
      };
      this.runs.set(runId, { child, state });
      child.on('exit', (code) => {
        const r = this.runs.get(runId);
        if (r) {
          r.state.status = 'exited';
          r.state.exitCode = code;
          this.onUpdate(r.state);
        }
      });
      return { runId, pid };
    } catch (e) {
      console.error('RunManager.start failed:', e);
      return null;
    }
  }

  stop(runId: string): number {
    const r = this.runs.get(runId);
    if (!r || r.state.status !== 'running') return 0;
    return this.native.killTree(r.state.pid);  // 复用 native killTree（过保护名单 + 收集后代）
  }

  restart(profile: RunProfile, runId: string): { runId: string; pid: number } | null {
    this.stop(runId);
    return this.start(profile);
  }

  getState(runId: string): RunState | null {
    return this.runs.get(runId)?.state ?? null;
  }

  allStates(): RunState[] {
    return [...this.runs.values()].map((r) => r.state);
  }
}

// ── profile 文件 IO（main 侧，仿 plugins.json）──

export function readProfiles(file: string): RunProfile[] {
  try {
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(validateProfile).filter((p): p is RunProfile => p !== null);
  } catch {
    return [];
  }
}

export function writeProfiles(file: string, profiles: RunProfile[]): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(profiles, null, 2), 'utf8');
}
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/runProfiles.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/electron/runProfiles.ts app/tests/runProfiles.test.ts
git commit -m "feat(app): RunManager + validateProfile + profile IO (F1 core)

validateProfile enforces whitelist command + absolute cwd + schema. RunManager
spawns via execFile (no shell), tracks Map<runId,ChildProcess>, stop reuses
native killTree. Profile file IO mirrors plugins.json pattern."
```

---

## Task 2: 类型 + IPC 通道（ipc-types.ts）

**Files:**
- Modify: `app/electron/ipc-types.ts`

- [ ] **Step 1: 加类型 + 通道 + ExposedApi**

在 `app/electron/ipc-types.ts`：

IPC 对象末尾（`FETCH_GIT_IDENTITY` 后）加：

```ts
  // Run Profiles（F1）：受控启动/停止开发服务。spawn 在 main，渲染层只传 profileId/runId。
  RUN_PROFILE_LIST: 'run:list',
  RUN_PROFILE_SAVE: 'run:save',
  RUN_PROFILE_DELETE: 'run:delete',
  RUN_START: 'run:start',
  RUN_STOP: 'run:stop',
  RUN_RESTART: 'run:restart',
  // run 状态事件（F1）：main 推 run exit/状态变更给渲染层（事件，非 invoke）
  RUN_UPDATE: 'run:update',
```

在 GitIdentity 类型之后加 RunProfile/RunState：

```ts
/** Run Profile（F1）：受控启动的开发服务配置。id 由 main 生成。command 限白名单。 */
export interface RunProfile {
  id: string;
  name: string;
  command: string;       // 白名单可执行名（node/npm/pnpm/yarn/python/git）
  args: string[];        // 参数数组（execFile 无 shell，不经拼接）
  cwd: string;           // 绝对路径
  expectedPorts?: number[]; // 预留 F2（端口意图），F1 不消费
}

/** 一个运行中的 profile 实例（main spawn 后产生）。 */
export interface RunState {
  runId: string;
  profileId: string;
  pid: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  startedAt: number;
}
```

ExposedApi 末尾（fetchGitIdentity 后）加：

```ts
  // Run Profiles（F1）。profile 文件 main 持有，渲染层只拿校验过的列表。
  listRunProfiles(): Promise<RunProfile[]>;
  saveRunProfile(profile: Omit<RunProfile, 'id'> & { id?: string }): Promise<RunProfile | null>;
  deleteRunProfile(id: string): Promise<boolean>;
  startProfile(profileId: string): Promise<{ runId: string; pid: number } | null>;
  stopProfile(runId: string): Promise<number>;
  restartProfile(runId: string): Promise<{ runId: string; pid: number } | null>;
  onRunUpdate(cb: (update: RunState) => void): () => void;
```

- [ ] **Step 2: typecheck（此时 preload/main 未改会红，预期）**

Run: `cd app && pnpm typecheck`
Expected: FAIL（ExposedApi 与 preload 不匹配）—— 后续 task 修复。

- [ ] **Step 3: Commit**

```bash
git add app/electron/ipc-types.ts
git commit -m "feat(app): RunProfile/RunState types + IPC channels (F1)"
```

---

## Task 3: main handler + preload + ipc.ts

**Files:**
- Modify: `app/electron/main.ts`
- Modify: `app/electron/preload.ts`
- Modify: `app/src/lib/ipc.ts`

- [ ] **Step 1: main import + RunManager 实例**

`app/electron/main.ts` 顶部 import 区加：

```ts
import { RunManager, readProfiles, writeProfiles, validateProfile } from './runProfiles';
import { randomUUID as _runUUID } from 'node:crypto';  // 已有 randomUUID import，复用即可，无需重复
```

注意：main 已 `import { randomUUID } from 'node:crypto'`（:4），无需重复 import。RunProfile/RunState 类型从 ipc-types 已 import（main 已 import IPC 等），补 import：

实际上 main 的 import 行是 `import { IPC, type LabelRulesPayload, ... } from './ipc-types';`，需补 RunProfile/RunState：

把该 import 行的 type 列表加 `type RunProfile, type RunState`。

在 main handler 区（fetchGitIdentity handler 之后）加：

```ts
// ── Run Profiles（F1）──
const RUN_PROFILES_FILE = () => path.join(app.getPath('userData'), 'run-profiles.json');
const runManager = new RunManager(
  native,  // 复用 native killTree
  (state) => {
    // run 状态变更 → 推送给渲染层
    win?.webContents.send(IPC.RUN_UPDATE, state);
  },
);

ipcMain.handle(IPC.RUN_PROFILE_LIST, (): RunProfile[] => {
  try {
    return readProfiles(RUN_PROFILES_FILE());
  } catch (e) {
    console.error('run:list failed:', e);
    return [];
  }
});

ipcMain.handle(IPC.RUN_PROFILE_SAVE, (_evt, profile: Omit<RunProfile, 'id'> & { id?: string }): RunProfile | null => {
  try {
    const full: RunProfile = { ...profile, id: profile.id ?? randomUUID() };
    const validated = validateProfile(full);
    if (!validated) return null;
    const profiles = readProfiles(RUN_PROFILES_FILE());
    const idx = profiles.findIndex((p) => p.id === validated.id);
    if (idx >= 0) profiles[idx] = validated;
    else profiles.push(validated);
    writeProfiles(RUN_PROFILES_FILE(), profiles);
    return validated;
  } catch (e) {
    console.error('run:save failed:', e);
    return null;
  }
});

ipcMain.handle(IPC.RUN_PROFILE_DELETE, (_evt, id: string): boolean => {
  try {
    const profiles = readProfiles(RUN_PROFILES_FILE()).filter((p) => p.id !== id);
    writeProfiles(RUN_PROFILES_FILE(), profiles);
    return true;
  } catch (e) {
    console.error('run:delete failed:', e);
    return false;
  }
});

ipcMain.handle(IPC.RUN_START, (_evt, profileId: string): { runId: string; pid: number } | null => {
  try {
    const profile = readProfiles(RUN_PROFILES_FILE()).find((p) => p.id === profileId);
    if (!profile) return null;
    return runManager.start(profile);
  } catch (e) {
    console.error('run:start failed:', e);
    return null;
  }
});

ipcMain.handle(IPC.RUN_STOP, (_evt, runId: string): number => {
  try {
    return runManager.stop(runId);
  } catch (e) {
    console.error('run:stop failed:', e);
    return 0;
  }
});

ipcMain.handle(IPC.RUN_RESTART, (_evt, runId: string): { runId: string; pid: number } | null => {
  try {
    const state = runManager.getState(runId);
    if (!state) return null;
    const profile = readProfiles(RUN_PROFILES_FILE()).find((p) => p.id === state.profileId);
    if (!profile) return null;
    return runManager.restart(profile, runId);
  } catch (e) {
    console.error('run:restart failed:', e);
    return null;
  }
});
```

- [ ] **Step 2: preload 封装**

`app/electron/preload.ts` 的 api 对象（fetchGitIdentity 后）加：

```ts
  listRunProfiles: () => ipcRenderer.invoke(IPC.RUN_PROFILE_LIST),
  saveRunProfile: (profile) => ipcRenderer.invoke(IPC.RUN_PROFILE_SAVE, profile),
  deleteRunProfile: (id) => ipcRenderer.invoke(IPC.RUN_PROFILE_DELETE, id),
  startProfile: (profileId) => ipcRenderer.invoke(IPC.RUN_START, profileId),
  stopProfile: (runId) => ipcRenderer.invoke(IPC.RUN_STOP, runId),
  restartProfile: (runId) => ipcRenderer.invoke(IPC.RUN_RESTART, runId),
  onRunUpdate: (cb) => {
    const handler = (_e: unknown, update: RunState) => cb(update);
    ipcRenderer.on(IPC.RUN_UPDATE, handler as never);
    return () => ipcRenderer.removeListener(IPC.RUN_UPDATE, handler as never);
  },
```

preload 顶部 import 加 `type RunProfile, type RunState`（与现有 LabelRulesPayload/SnapshotEntry 同 import 行）。

- [ ] **Step 3: ipc.ts 渲染封装**

`app/src/lib/ipc.ts` 顶部 import 加 `RunProfile, RunState`。ipc 对象末尾加：

```ts
  async listRunProfiles(): Promise<RunProfile[]> {
    return window.codemgr.listRunProfiles();
  },
  async saveRunProfile(profile: Omit<RunProfile, 'id'> & { id?: string }): Promise<RunProfile | null> {
    return window.codemgr.saveRunProfile(profile);
  },
  async deleteRunProfile(id: string): Promise<boolean> {
    return window.codemgr.deleteRunProfile(id);
  },
  async startProfile(profileId: string): Promise<{ runId: string; pid: number } | null> {
    return window.codemgr.startProfile(profileId);
  },
  async stopProfile(runId: string): Promise<number> {
    return window.codemgr.stopProfile(runId);
  },
  async restartProfile(runId: string): Promise<{ runId: string; pid: number } | null> {
    return window.codemgr.restartProfile(runId);
  },
  onRunUpdate(cb: (update: RunState) => void): () => void {
    return window.codemgr.onRunUpdate(cb);
  },
```

- [ ] **Step 4: typecheck**

Run: `cd app && pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/electron/main.ts app/electron/preload.ts app/src/lib/ipc.ts
git commit -m "feat(app): run profile IPC handlers + preload + renderer wiring (F1)"
```

---

## Task 4: store + hook + mock

**Files:**
- Create: `app/src/store/runProfileStore.ts`
- Create: `app/src/hooks/useRunProfiles.ts`
- Modify: `app/tests/setup.ts`

- [ ] **Step 1: store**

新建 `app/src/store/runProfileStore.ts`：

```ts
import { create } from 'zustand';
import type { RunProfile, RunState } from '../../electron/ipc-types';

interface RunProfileState {
  profiles: RunProfile[];
  runs: RunState[];  // 运行中实例（运行时态）
  setProfiles: (p: RunProfile[]) => void;
  upsertRun: (r: RunState) => void;   // onRunUpdate 收到时 upsert
  removeRun: (runId: string) => void;
  reset: () => void;
}

export const useRunProfileStore = create<RunProfileState>((set) => ({
  profiles: [],
  runs: [],
  setProfiles: (p) => set({ profiles: p }),
  upsertRun: (r) => set((s) => {
    const others = s.runs.filter((x) => x.runId !== r.runId);
    return { runs: [...others, r] };
  }),
  removeRun: (runId) => set((s) => ({ runs: s.runs.filter((x) => x.runId !== runId) })),
  reset: () => set({ profiles: [], runs: [] }),
}));
```

- [ ] **Step 2: hook**

新建 `app/src/hooks/useRunProfiles.ts`：

```ts
import { useEffect } from 'react';
import { ipc } from '../lib/ipc';
import { useRunProfileStore } from '../store/runProfileStore';

/** 挂载时拉 profiles + 订阅 run 状态事件。卸载时取消订阅。 */
export function useRunProfiles() {
  const setProfiles = useRunProfileStore((s) => s.setProfiles);
  const upsertRun = useRunProfileStore((s) => s.upsertRun);

  useEffect(() => {
    ipc.listRunProfiles().then(setProfiles).catch(() => { /* ignore */ });
    const unsub = ipc.onRunUpdate((update) => upsertRun(update));
    return () => unsub();
  }, [setProfiles, upsertRun]);
}

/** 操作后刷新 profiles（save/delete 后调）。 */
export async function refreshProfiles() {
  const profiles = await ipc.listRunProfiles();
  useRunProfileStore.getState().setProfiles(profiles);
}
```

- [ ] **Step 3: mock 同步**

`app/tests/setup.ts` 的 base 对象加：

```ts
    listRunProfiles: vi.fn(() => Promise.resolve([])),
    saveRunProfile: vi.fn(() => Promise.resolve(null)),
    deleteRunProfile: vi.fn(() => Promise.resolve(true)),
    startProfile: vi.fn(() => Promise.resolve(null)),
    stopProfile: vi.fn(() => Promise.resolve(0)),
    restartProfile: vi.fn(() => Promise.resolve(null)),
    onRunUpdate: vi.fn(() => () => {}),
```

- [ ] **Step 4: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/src/store/runProfileStore.ts app/src/hooks/useRunProfiles.ts app/tests/setup.ts
git commit -m "feat(app): runProfileStore + useRunProfiles hook + mock (F1)"
```

---

## Task 5: RunProfileEditor 组件

**Files:**
- Create: `app/src/components/RunProfileEditor.tsx`

- [ ] **Step 1: 实现编辑器**

新建 `app/src/components/RunProfileEditor.tsx`：

```tsx
import { useState } from 'react';
import type { RunProfile } from '../../electron/ipc-types';
import { ipc } from '../lib/ipc';
import { refreshProfiles } from '../hooks/useRunProfiles';

const COMMAND_OPTIONS = ['node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'git'];

export function RunProfileEditor({
  editing,
  onClose,
}: {
  editing: RunProfile | null;  // null = 新建
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [command, setCommand] = useState(editing?.command ?? 'pnpm');
  const [argsText, setArgsText] = useState((editing?.args ?? []).join(' '));
  const [cwd, setCwd] = useState(editing?.cwd ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !cwd.trim()) {
      setError('名称和工作目录不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      const result = await ipc.saveRunProfile({
        id: editing?.id,
        name: name.trim(),
        command,
        args,
        cwd: cwd.trim(),
      });
      if (!result) {
        setError('保存失败：command 不在白名单或 cwd 非绝对路径');
      } else {
        await refreshProfiles();
        onClose();
      }
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-base-600 bg-base-800 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-semibold text-fg-primary">{editing ? '编辑 Profile' : '新建 Profile'}</h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-fg-muted">名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-base-600 bg-base-900 px-2 py-1 text-fg-primary" placeholder="前端 dev" />
          </label>
          <label className="block">
            <span className="text-fg-muted">命令（白名单）</span>
            <select value={command} onChange={(e) => setCommand(e.target.value)} className="mt-1 w-full rounded border border-base-600 bg-base-900 px-2 py-1 text-fg-primary">
              {COMMAND_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-fg-muted">参数（空格分隔）</span>
            <input value={argsText} onChange={(e) => setArgsText(e.target.value)} className="mt-1 w-full rounded border border-base-600 bg-base-900 px-2 py-1 font-mono text-fg-primary" placeholder="dev" />
          </label>
          <label className="block">
            <span className="text-fg-muted">工作目录（绝对路径）</span>
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} className="mt-1 w-full rounded border border-base-600 bg-base-900 px-2 py-1 font-mono text-fg-primary" placeholder="E:\repo\app" />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-base-600 px-4 py-1.5 text-sm text-fg-secondary hover:bg-base-700">取消</button>
          <button onClick={save} disabled={saving} className="rounded bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent/80 disabled:opacity-50">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/components/RunProfileEditor.tsx
git commit -m "feat(app): RunProfileEditor modal (F1)"
```

---

## Task 6: RunProfilesPanel + mosaic 注册

**Files:**
- Create: `app/src/components/RunProfilesPanel.tsx`
- Modify: `app/src/store/layoutStore.ts`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: 实现 Panel**

新建 `app/src/components/RunProfilesPanel.tsx`：

```tsx
import { useState } from 'react';
import { useRunProfiles, refreshProfiles } from '../hooks/useRunProfiles';
import { useRunProfileStore } from '../store/runProfileStore';
import { ipc } from '../lib/ipc';
import { RunProfileEditor } from './RunProfileEditor';
import type { RunProfile } from '../../electron/ipc-types';

export function RunProfilesPanel() {
  useRunProfiles();
  const profiles = useRunProfileStore((s) => s.profiles);
  const runs = useRunProfileStore((s) => s.runs);
  const [editing, setEditing] = useState<RunProfile | null | undefined>(undefined); // undefined=关闭, null=新建, profile=编辑
  const [busy, setBusy] = useState<string | null>(null);  // 正在操作的 profileId

  function runOf(profileId: string) {
    return runs.find((r) => r.profileId === profileId && r.status === 'running');
  }

  async function start(profileId: string) {
    setBusy(profileId);
    try {
      const r = await ipc.startProfile(profileId);
      if (!r) alert('启动失败：command 不在白名单或 cwd 无效');
    } catch (e) { alert(`启动失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function stop(runId: string, profileId: string) {
    setBusy(profileId);
    try { await ipc.stopProfile(runId); }
    catch (e) { alert(`停止失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function restart(runId: string, profileId: string) {
    setBusy(profileId);
    try { await ipc.restartProfile(runId); }
    catch (e) { alert(`重启失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function del(profileId: string) {
    if (!confirm('确定删除此 profile？')) return;
    await ipc.deleteRunProfile(profileId);
    await refreshProfiles();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">Run Profiles</h1>
          <p className="text-xs text-fg-muted">{profiles.length} 个配置 · {runs.filter((r) => r.status === 'running').length} 个运行中</p>
        </div>
        <button onClick={() => setEditing(null)} className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent/80">新建</button>
      </header>
      <div className="flex-1 overflow-auto p-3">
        {profiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-fg-muted">
            尚无 Run Profile。点「新建」配置一个开发服务（如 pnpm dev）。
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => {
              const run = runOf(p.id);
              const isBusy = busy === p.id;
              return (
                <div key={p.id} className="rounded-lg border border-base-700 bg-base-800/60 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-fg-primary">{p.name}</span>
                      {run && <span className="ml-2 rounded bg-green-500/20 px-1 text-[10px] text-green-400">running · PID {run.pid}</span>}
                    </div>
                    <div className="flex gap-1">
                      {!run ? (
                        <button onClick={() => start(p.id)} disabled={isBusy} className="rounded bg-accent/80 px-2 py-0.5 text-xs text-white hover:bg-accent disabled:opacity-50">启动</button>
                      ) : (
                        <>
                          <button onClick={() => restart(run.runId, p.id)} disabled={isBusy} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600 disabled:opacity-50">重启</button>
                          <button onClick={() => stop(run.runId, p.id)} disabled={isBusy} className="rounded bg-red-600/80 px-2 py-0.5 text-xs text-white hover:bg-red-500 disabled:opacity-50">停止</button>
                        </>
                      )}
                      <button onClick={() => setEditing(p)} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600">编辑</button>
                      <button onClick={() => del(p.id)} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-muted hover:bg-base-600">删</button>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-fg-muted">{p.command} {p.args.join(' ')}</div>
                  <div className="font-mono text-xs text-fg-muted truncate">{p.cwd}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing !== undefined && <RunProfileEditor editing={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
```

- [ ] **Step 2: mosaic 注册**

`app/src/store/layoutStore.ts`：
- `BuiltInPanelId` 加 `'run-profiles'`：

```ts
export type BuiltInPanelId = 'port' | 'process' | 'perf' | 'snapshot' | 'sessions' | 'run-profiles';
```
- `isBuiltInPanel` 加 `id === 'run-profiles'`。

`app/src/App.tsx`：
- `BUILTIN_TITLES` 加 `run-profiles: 'Run Profiles',`。
- `ALL_BUILTIN` 加 `'run-profiles'`。
- import 加 `import { RunProfilesPanel } from './components/RunProfilesPanel';`。
- renderTile 加 `{id === 'run-profiles' && <RunProfilesPanel />}`。

- [ ] **Step 3: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add app/src/components/RunProfilesPanel.tsx app/src/store/layoutStore.ts app/src/App.tsx
git commit -m "feat(app): RunProfilesPanel + mosaic registration (F1)"
```

---

## Task 7: 全量验收

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（含新增 validateProfile 9）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native 改动**

Run: `git diff <f1-spec-commit>..HEAD --stat -- codemgr-native`
Expected: 空（spawn 是 Node child_process，killTree 复用）。

- [ ] **Step 4: 更新 AGENTS.md §8**

用实际测试数更新。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after F1 Run Profiles"
```

- [ ] **Step 6: 人工验收（记 PR）**

1. mosaic 添加 'Run Profiles' 面板。
2. 新建 profile：前端 / pnpm / dev / E:\repo\app。
3. 启动 → 进程面板出现 pnpm/node（被 processScan 捕获）→ Run Profiles 显示 running 徽章 + pid。
4. 停止 → killTree → 进程消失 → 状态变 exited。
5. 重启 → 新 pid。
6. 重启 CodeMgr → profile 仍在（持久化）。
7. 尝试 command=calc（编辑器无此选项，白名单外无法保存）。
