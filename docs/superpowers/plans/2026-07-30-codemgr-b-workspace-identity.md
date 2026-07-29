# CodeMgr B — Workspace Git 身份 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增按需 Git 身份解析（从进程 cwd 向上找 .git，解析 branch/HEAD/worktree），在进程详情侧栏展示，不改分组、不进 native、不进热路径。

**Architecture:** 纯函数 `resolveGitIdentity(cwd)` 放 `app/electron/gitWorkspace.ts`（main 域，Node fs/path），经按需 IPC 通道 `fetchGitIdentity(cwd)` 暴露。侧栏按钮触发，store 旁路缓存（仿 preciseCwdByPid）。4 处接线，无 native。

**Tech Stack:** Node fs/path（main）+ Electron IPC + React + Zustand。无 native / build:electron / bench。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-b-workspace-identity.md`

**分支:** `docs/a1-bugfix-spec`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新建纯函数 | `app/electron/gitWorkspace.ts` | `resolveGitIdentity(cwd)`：fs 向上找 .git + 解析 HEAD/commondir/worktree |
| 类型 | `app/electron/ipc-types.ts` | `GitIdentity` 接口 + `IPC.FETCH_GIT_IDENTITY` + `ExposedApi.fetchGitIdentity` |
| main handler | `app/electron/main.ts` | `ipcMain.handle`（调 resolveGitIdentity，catch→null） |
| preload | `app/electron/preload.ts` | invoke 封装 |
| 渲染封装 | `app/src/lib/ipc.ts` | 薄封装 |
| store 缓存 | `app/src/store/processPanelStore.ts` | `gitIdentityByPid` + setGitIdentity（仿 preciseCwdByPid prune） |
| 侧栏 | `app/src/components/ProcessDetailSidebar.tsx` | Git 信息块 + 按钮（仿 loadCwd） |
| mock | `app/tests/setup.ts` | fetchGitIdentity 默认 mock |
| 纯函数测试 | `app/tests/gitWorkspace.test.ts`（新建） | TDD（用 os.tmpdir 造 fixture） |

---

## Task 1: resolveGitIdentity 纯函数（TDD 核心）

> 整个 B 的核心逻辑。先 TDD，用 tmpdir 造 .git fixture。

**Files:**
- Create: `app/electron/gitWorkspace.ts`
- Test: `app/tests/gitWorkspace.test.ts`

- [ ] **Step 1: 写失败测试（普通仓库 + detached + 非 git + 空 cwd）**

新建 `app/tests/gitWorkspace.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGitIdentity } from '../electron/gitWorkspace';

// 在 tmpdir 下造一个 git 仓库结构，返回根路径。
function makeRepo(opts: { head?: string; gitDir?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'cm-git-'));
  const gitDir = join(root, '.git');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), opts.head ?? 'ref: refs/heads/main\n');
  return root;
}

describe('resolveGitIdentity', () => {
  let repos: string[] = [];
  afterEach(() => {
    for (const r of repos) {
      if (existsSync(r)) rmSync(r, { recursive: true, force: true });
    }
    repos = [];
  });

  it('resolves a normal repo on branch', () => {
    const root = makeRepo({ head: 'ref: refs/heads/feature/login\n' });
    repos.push(root);
    const id = resolveGitIdentity(root);
    expect(id).not.toBeNull();
    expect(id!.branch).toBe('feature/login');
    expect(id!.detached).toBe(false);
    expect(id!.isWorktree).toBe(false);
    expect(id!.gitRoot.replace(/\\/g, '/')).toBe(root.replace(/\\/g, '/'));
  });

  it('resolves detached HEAD', () => {
    const root = makeRepo({ head: '0123456789abcdef0123456789abcdef01234567\n' });
    repos.push(root);
    const id = resolveGitIdentity(root);
    expect(id).not.toBeNull();
    expect(id!.branch).toBeNull();
    expect(id!.detached).toBe(true);
    expect(id!.head.startsWith('0123456789')).toBe(true);
  });

  it('finds .git from a subdirectory (walks up)', () => {
    const root = makeRepo();
    repos.push(root);
    const sub = join(root, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    const id = resolveGitIdentity(sub);
    expect(id).not.toBeNull();
    expect(id!.branch).toBe('main');
  });

  it('returns null for non-git directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-nongit-'));
    repos.push(root);
    expect(resolveGitIdentity(root)).toBeNull();
  });

  it('returns null for empty cwd', () => {
    expect(resolveGitIdentity('')).toBeNull();
  });

  it('resolves a linked worktree (.git is a file with gitdir:)', () => {
    // 主仓库
    const mainRepo = makeRepo();
    repos.push(mainRepo);
    // worktree 目录
    const wt = mkdtempSync(join(tmpdir(), 'cm-wt-'));
    repos.push(wt);
    const wtMeta = join(mainRepo, '.git', 'worktrees', 'wt-name');
    mkdirSync(wtMeta, { recursive: true });
    writeFileSync(join(wtMeta, 'commondir'), join(mainRepo, '.git') + '\n');
    writeFileSync(join(wtMeta, 'gitdir'), join(wt, '.git') + '\n');
    // worktree 的 .git 是文件，指向 wtMeta
    writeFileSync(join(wt, '.git'), 'gitdir: ' + wtMeta + '\n');
    const id = resolveGitIdentity(wt);
    expect(id).not.toBeNull();
    expect(id!.isWorktree).toBe(true);
    expect(id!.branch).toBe('main');
  });

  it('returns null when .git file has invalid format (no gitdir:)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-badgit-'));
    repos.push(root);
    writeFileSync(join(root, '.git'), 'garbage content\n');
    expect(resolveGitIdentity(root)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/gitWorkspace.test.ts`
Expected: FAIL —— `resolveGitIdentity is not a function`（模块不存在）。

- [ ] **Step 3: 实现 resolveGitIdentity**

新建 `app/electron/gitWorkspace.ts`：

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { GitIdentity } from './ipc-types';

// 规范化 Windows 路径：大写盘符 + 正斜杠，剥 NT 前缀（与 projectGroup.normPath 对齐）。
function normPath(p: string): string {
  return p
    .replace(/^(?:\\\?\?\\|\\\\\?\\)/i, '')
    .replace(/\\/g, '/')
    .replace(/^[a-z]:/, (m) => m.toUpperCase())
    .replace(/\/$/, '');
}

// 读文件首行去尾换行；文件不存在/读失败返回 null。
function readLine(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

// 向上递归找 .git，返回 { gitEntry: .git 路径, treeRoot: 工作树根 }。
function findGitDir(startDir: string): { gitEntry: string; treeRoot: string } | null {
  let dir = normPath(startDir).replace(/\//g, path.sep);
  for (let i = 0; i < 40; i++) {  // 上限防死循环
    const dotGit = path.join(dir, '.git');
    if (existsSync(dotGit)) return { gitEntry: dotGit, treeRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 从 cwd 解析 Git 仓库身份（B，按需）。纯 fs 文件解析，不 spawn git。
 * 非 git 目录 / 解析失败 → null。详见 spec §3。
 */
export function resolveGitIdentity(cwd: string): GitIdentity | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const found = findGitDir(cwd);
  if (!found) return null;
  const { gitEntry, treeRoot } = found;
  const gitStat = statSync(gitEntry);

  let commonDir: string;
  let isWorktree: boolean;

  if (gitStat.isDirectory()) {
    // 普通仓库
    commonDir = gitEntry;
    isWorktree = false;
  } else {
    // .git 是文件 → 链接 worktree，内容形如 "gitdir: <path>"
    const content = readLine(gitEntry);
    if (!content || !content.startsWith('gitdir:')) return null;
    const gitdirPath = content.slice('gitdir:'.length).trim();
    // gitdirPath 指向 <mainRepo>/.git/worktrees/<name>
    const commondirFile = path.join(gitdirPath, 'commondir');
    const cd = readLine(commondirFile);
    if (!cd) return null;  // 非 worktree（如 submodule）→ 首轮不支持，降级 null
    commonDir = path.isAbsolute(cd) ? cd : path.resolve(gitdirPath, cd);
    isWorktree = true;
  }

  // 解析 HEAD
  const headContent = readLine(path.join(commonDir, 'HEAD'));
  if (headContent === null) return null;

  let branch: string | null;
  let detached: boolean;
  let head: string;

  if (headContent.startsWith('ref: ')) {
    const ref = headContent.slice('ref: '.length).trim();
    detached = false;
    head = ref;  // refs/heads/main
    // branch = refs/heads/ 后的部分
    const m = ref.match(/^refs\/heads\/(.+)$/);
    branch = m ? m[1] : null;
  } else {
    // 40 字符 SHA → detached
    detached = true;
    branch = null;
    head = headContent;
  }

  return {
    gitRoot: normPath(treeRoot),
    commonDir: normPath(commonDir),
    branch,
    head,
    detached,
    isWorktree,
  };
}
```

- [ ] **Step 4: 新增 GitIdentity 类型（让 import 不报错）**

在 `app/electron/ipc-types.ts`（SnapshotEntry 之前，约 :89 前）追加：

```ts
/**
 * 进程 cwd 所属 Git 仓库的身份（B，按需解析）。纯 fs 文件解析，不 spawn git。
 * 解析失败（非 git 目录/权限/边界）→ fetchGitIdentity 返回 null。
 */
export interface GitIdentity {
  gitRoot: string;
  commonDir: string;
  branch: string | null;
  head: string;
  detached: boolean;
  isWorktree: boolean;
}
```

- [ ] **Step 5: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/gitWorkspace.test.ts`
Expected: PASS —— 全部 7 用例通过。

- [ ] **Step 6: Commit**

```bash
git add app/electron/gitWorkspace.ts app/electron/ipc-types.ts app/tests/gitWorkspace.test.ts
git commit -m "feat(app): resolveGitIdentity pure function (B workspace identity)

Walks up from cwd to find .git, parses HEAD (branch/detached), commondir,
and worktree gitdir pointer via pure fs (no git spawn). Returns null for
non-git dirs, invalid .git format, submodules (first pass)."
```

---

## Task 2: IPC 接线（通道 + main + preload + ipc.ts）

**Files:**
- Modify: `app/electron/ipc-types.ts`
- Modify: `app/electron/main.ts`
- Modify: `app/electron/preload.ts`
- Modify: `app/src/lib/ipc.ts`

- [ ] **Step 1: 加 IPC 通道常量 + ExposedApi 签名**

`app/electron/ipc-types.ts`：
- `IPC` 对象（:2-35）末尾（`SNAPSHOT_LOAD` 后）加：

```ts
  // 工作区 Git 身份（B）：按需从 cwd 解析 git root/branch/HEAD/worktree。纯 fs，不 spawn git。
  FETCH_GIT_IDENTITY: 'git:fetchIdentity',
```

- `ExposedApi` 接口末尾（:228 `}` 前，loadSnapshot 后）加：

```ts
  // 工作区 Git 身份（B）。接受 cwd（非 pid），main 用 fs 解析。null=非 git 目录/解析失败。
  fetchGitIdentity(cwd: string): Promise<GitIdentity | null>;
```

- [ ] **Step 2: main handler**

`app/electron/main.ts` 顶部 import 加 `resolveGitIdentity`：

```ts
import { resolveGitIdentity } from './gitWorkspace';
```

（放在已有的 `import { IPC, ... } from './ipc-types';` 附近。）

在 main 的 ipcMain.handle 区（其它 handler 之后，如 SNAPSHOT_LOAD handler 之后）加：

```ts
// 工作区 Git 身份（B）：纯 fs 解析，catch→null（非 git 目录/权限/边界）。
ipcMain.handle(IPC.FETCH_GIT_IDENTITY, async (_evt, cwd: string) => {
  try {
    return resolveGitIdentity(cwd);
  } catch (e) {
    console.error('fetchGitIdentity failed:', e);
    return null;
  }
});
```

- [ ] **Step 3: preload 封装**

`app/electron/preload.ts` 的 `api` 对象（loadSnapshot 后，:37 附近）加：

```ts
  fetchGitIdentity: (cwd: string) => ipcRenderer.invoke(IPC.FETCH_GIT_IDENTITY, cwd),
```

并在顶部 import 加 `GitIdentity`（若类型需要；preload 用 ExposedApi 推断，可能不需显式 import——typecheck 会告知）。

- [ ] **Step 4: 渲染层 ipc.ts 封装**

`app/src/lib/ipc.ts` 顶部 import 加 `GitIdentity`：

```ts
import type { NetConnection, ProcessInfo, CpuUsage, PerfData, LabelRulesPayload, PluginManifestEntry, SnapshotEntry, SnapshotMeta, ProcessSnapshot, GitIdentity } from '../../electron/ipc-types';
```

ipc 对象末尾（loadSnapshot 后）加：

```ts
  async fetchGitIdentity(cwd: string): Promise<GitIdentity | null> {
    return window.codemgr.fetchGitIdentity(cwd);
  },
```

- [ ] **Step 5: typecheck 确认接线一致**

Run: `cd app && pnpm typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add app/electron/ipc-types.ts app/electron/main.ts app/electron/preload.ts app/src/lib/ipc.ts
git commit -m "feat(app): fetchGitIdentity IPC channel (B workspace identity)"
```

---

## Task 3: store 缓存 + mock 同步

**Files:**
- Modify: `app/src/store/processPanelStore.ts`
- Modify: `app/tests/setup.ts`

- [ ] **Step 1: store 加 gitIdentityByPid 缓存**

`app/src/store/processPanelStore.ts`：
- 顶部 import 加 `GitIdentity`：

```ts
import type { ProcessInfo, GitIdentity } from '../../electron/ipc-types';
```

- 接口 `ProcessPanelState`（preciseCwdByPid 附近）加：

```ts
  // Git 身份旁路缓存（B，按需解析）：pid → identity（null=已解析但非 git）。
  // 与 preciseCwdByPid 同生命周期：随 pidSet 清理，不持久化。
  gitIdentityByPid: Record<number, GitIdentity | null>;
```

- 接口加 setter（setPreciseCwd 附近）：

```ts
  setGitIdentity: (pid: number, identity: GitIdentity | null) => void;
```

- 初始 state（preciseCwdByPid: {} 附近）加：

```ts
  gitIdentityByPid: {},
```

- `setProcesses` 的 prune 块（preciseCwdByPid prune 之后）加 gitIdentity prune：

```ts
        const gitIdentityByPid: Record<number, GitIdentity | null> = {};
        for (const k of Object.keys(s.gitIdentityByPid)) {
          const n = Number(k);
          if (pidSet.has(n)) gitIdentityByPid[n] = s.gitIdentityByPid[n];
        }
```

并把 return 对象的 `preciseCwdByPid` 后加 `gitIdentityByPid`：

```ts
        return { processes: p, error: null, staleAt: null, selectedPids, cpuMap, procHistory, preciseCwdByPid, gitIdentityByPid };
```

- 新增 setter（setPreciseCwd 附近）：

```ts
      setGitIdentity: (pid, identity) => set((s) => ({ gitIdentityByPid: { ...s.gitIdentityByPid, [pid]: identity } })),
```

- `reset`（preciseCwdByPid: {} 附近）加 `gitIdentityByPid: {},`。

- [ ] **Step 2: mock 同步**

`app/tests/setup.ts` 的 `mockIpc` 的 `base` 对象加：

```ts
    fetchGitIdentity: vi.fn(() => Promise.resolve(null)),
```

（放在 fetchPerf 等附近。）

- [ ] **Step 3: typecheck + 全量测试确认无回归**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add app/src/store/processPanelStore.ts app/tests/setup.ts
git commit -m "feat(app): gitIdentityByPid cache in processPanelStore (B)"
```

---

## Task 4: 侧栏 Git 信息块

**Files:**
- Modify: `app/src/components/ProcessDetailSidebar.tsx`

- [ ] **Step 1: 加 Git state + loadGitIdentity**

`app/src/components/ProcessDetailSidebar.tsx`：
- store 解构（:17）加 `gitIdentityByPid, setGitIdentity`：

```tsx
  const { processes, selectedPids, procHistory, preciseCwdByPid, setPreciseCwd,
    gitIdentityByPid, setGitIdentity } = useProcessPanelStore();
```

- import 加 `GitIdentity` 类型（从 ipc-types）：

```tsx
import type { GitIdentity } from '../../electron/ipc-types';
```

- 在 cwdState state 附近（:28 后）加 git state：

```tsx
  // Git 身份（B，按需）：优先复用 store 缓存，未命中按需拉取。
  const [gitIdentity, setGitIdentityLocal] = useState<GitIdentity | null | undefined>(undefined);
  const [gitState, setGitState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
```

（`undefined` = 未解析，`null` = 已解析非 git，`GitIdentity` = 已解析。）

- 在 pid 变化 effect（:29-41）里加 git 重置（与 cwd 同模式）：

```tsx
    // Git 身份：store 缓存命中则展示，否则 idle
    const cachedGit = pid != null ? gitIdentityByPid[pid] : undefined;
    if (cachedGit !== undefined) {
      setGitIdentityLocal(cachedGit);
      setGitState('done');
    } else {
      setGitIdentityLocal(undefined);
      setGitState('idle');
    }
```

（加在 cwd 重置逻辑之后，effect 依赖数组加 `gitIdentityByPid`。）

- 新增 loadGitIdentity（loadCwd 之后）：

```tsx
  async function loadGitIdentity() {
    if (pid == null) return;
    // store 缓存命中：直接展示
    const cached = gitIdentityByPid[pid];
    if (cached !== undefined) {
      setGitIdentityLocal(cached);
      setGitState('done');
      return;
    }
    // 取 cwd：精确优先，回退启发式；空则先级联拉精确 cwd
    let cwd = preciseCwdByPid[pid] ?? proc?.cwd ?? '';
    setGitState('loading');
    try {
      if (!cwd) {
        const precise = await ipc.fetchCwd(pid);
        if (pidRef.current !== pid) return;
        cwd = precise ?? '';
        if (cwd) setStoreCwd(pid, cwd);
      }
      if (!cwd) {
        // 无 cwd 可解析
        setGitIdentityLocal(null);
        setGitState('done');
        setGitIdentity(pid, null);
        return;
      }
      const identity = await ipc.fetchGitIdentity(cwd);
      if (pidRef.current !== pid) return;
      setGitIdentityLocal(identity);
      setGitState('done');
      setGitIdentity(pid, identity);  // 写回 store 缓存（null 也写，避免重复 IPC）
    } catch {
      if (pidRef.current !== pid) return;
      setGitState('error');
    }
  }
```

注意：`proc` 在 loadGitIdentity 调用时已保证存在（按钮在 proc 渲染块内）。但 TS 可能因闭包报 `proc` 可能 undefined——用 `processes.find` 重新取或加非空断言。最稳妥：在函数内重取 `const p = processes.find(x => x.pid === pid); const cwd = preciseCwdByPid[pid] ?? p?.cwd ?? '';`。

- [ ] **Step 2: 渲染 Git 信息块**

在"工作目录"块的 `</div>` 之后（:160 附近，"父进程 PID" Row 之前）加 Git 块：

```tsx
          <div>
            <dt className="text-fg-muted">Git</dt>
            <dd className="mt-0.5">
              {gitState === 'idle' && (
                <button onClick={loadGitIdentity} className="text-accent hover:underline">
                  解析 Git 身份
                </button>
              )}
              {gitState === 'loading' && <span className="text-fg-muted">解析中…</span>}
              {gitState === 'error' && (
                <span className="text-fg-muted">解析失败</span>
              )}
              {gitState === 'done' && gitIdentity === null && (
                <span className="text-fg-muted">非 Git 仓库</span>
              )}
              {gitState === 'done' && gitIdentity && (
                <div className="space-y-0.5 font-mono text-fg-secondary">
                  <div>
                    {gitIdentity.detached
                      ? `detached @ ${gitIdentity.head.slice(0, 8)}`
                      : gitIdentity.branch}
                    {gitIdentity.isWorktree && (
                      <span className="ml-1 rounded bg-base-700 px-1 text-[10px] text-fg-muted">worktree</span>
                    )}
                  </div>
                  <div className="break-all text-fg-muted text-[11px]">{gitIdentity.gitRoot}</div>
                </div>
              )}
            </dd>
          </div>
```

- [ ] **Step 3: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ProcessDetailSidebar.tsx
git commit -m "feat(app): show Git identity (branch/head/worktree) in detail sidebar (B)

On-demand button resolves git root/branch/HEAD/isWorktree from the process
cwd (cascades to precise cwd if heuristic is empty). Cached in
gitIdentityByPid. Non-git dirs show '非 Git 仓库'. Display-only, does not
change grouping."
```

---

## Task 5: 全量验收

**Files:** 无

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（含新增 gitWorkspace +7）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native 改动**

Run: `git diff <b-spec-commit>..HEAD --stat -- codemgr-native`
Expected: 空。

- [ ] **Step 4: 更新 AGENTS.md §8**

用实际测试数更新 `app N/N`。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after B workspace identity"
```

- [ ] **Step 6: 人工验收备忘（记 PR）**

真机验证：选一个 git 仓库里的进程 → 侧栏"解析 Git 身份" → 显示 branch/gitRoot。
非 git 进程 → "非 Git 仓库"。
worktree 进程 → 显示 worktree 徽章。
