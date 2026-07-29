# CodeMgr B — Workspace Git 身份（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：审查报告产品能力增强方向 B；A1 spec 将本项列为后续独立 spec。
> 方法：brainstorming skill（调研 → 产品决策已确认：仅侧栏展示，不改分组 → 设计锁定）。
> 产品决策（用户确认 2026-07-30）：**Git 身份仅在进程详情侧栏展示，不改 `groupByProject` 分组行为**。同 repo 多 worktree 仍是独立组（A1 Bug #3 已保证它们 key 不冲突）。这把 B 从"分组架构改造"降级为"新增按需通道 + 侧栏展示"，风险大幅降低。

---

## 0. 背景与价值

当前进程的"项目身份"只有 cwd（启发式/精确）。AI 开发者常同时操作多个 repo / worktree / 分支，"这个 node 进程属于哪个 repo 的哪个分支"是高频问题，但 CodeMgr 无法回答。

本 spec 新增按需 Git 身份解析：从进程 cwd 向上递归找 `.git`，解析 branch/HEAD/worktree，在进程详情侧栏展示。它是后续 D（诊断导出：诊断包含 workspace/branch）、E（AI Session：session 归属 workspace）的地基。

---

## 1. 范围

### 1.1 包含

新增按需 IPC 通道 `fetchGitIdentity(cwd)`，在进程详情侧栏展示 Git 信息（branch/HEAD/gitRoot/isWorktree）。

- **解析层：main 进程（Node `fs`/`path`），不 spawn git、不进 native。** 纯文件解析（向上找 `.git`、读 `HEAD`/`commondir`/worktree 指针），无 git 可执行依赖、无超时风险。
- **触发：按需**，由侧栏按钮触发（与"读取精确工作目录"同构），不进 processScan 热路径。
- **展示：ProcessDetailSidebar 新增 Git 信息块**，与 cwd 同区。
- **不改分组**：`groupByProject` 完全不动。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/electron/ipc-types.ts` | 新增 `IPC.FETCH_GIT_IDENTITY` + `GitIdentity` 类型 + `ExposedApi.fetchGitIdentity` |
| `app/electron/main.ts` | 新增 handler（fs 解析，catch→null） |
| `app/electron/preload.ts` | invoke 封装 |
| `app/src/lib/ipc.ts` | 渲染层薄封装 |
| `app/electron/gitWorkspace.ts`（新建） | 纯函数：从 cwd 解析 GitIdentity（TDD 核心）。放 electron 域避免 main import 渲染层（§4 修正） |
| `app/src/components/ProcessDetailSidebar.tsx` | 新增 Git 信息块 + 按钮触发 |
| `app/src/store/processPanelStore.ts` | 新增 `gitIdentityByPid` 缓存（旁路，仿 `preciseCwdByPid`） |
| `app/tests/gitWorkspace.test.ts`（新建） | 纯函数 TDD（import `../../electron/gitWorkspace`，既有范式见 `ipc.ts:1`） |
| `app/tests/setup.ts` | mockIpc 加 `fetchGitIdentity` 默认 mock |

### 1.3 明确不做

- **不改分组行为**（产品决策）。`groupByProject` 不动；A1 的 identity 键（`dir ?? name`）保持。
- **不 spawn git**。纯 fs 文件解析足够得到 root/worktree/branch/HEAD。remote/ahead-behind/rebase 状态等 porcelain 信息留后续。
- **不进 native 层**。native 是"直读 Win32/NT API"范式，git 文件解析与 collector 单一职责相悖。
- **不进 processScan 热路径**（AGENTS.md §10 红线）。纯按需。
- **不支持 bare repo / submodule**。首轮遇到降级为 null。
- **不做 workspaceId 聚合**（同 repo 多 worktree 合并）。产品决策为仅展示，不聚合。

### 1.4 成功标准

- 进程详情侧栏能展示其 cwd 所属 repo 的 branch/HEAD/gitRoot。
- 非 git 目录 / git 不可解析 → 显示"非 Git 仓库"（非错误）。
- 不改进程分组行为（既有 projectGroup 测试全绿）。
- 不改 native（无需 `build:electron`/bench）。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。

---

## 2. 数据模型

新增到 `app/electron/ipc-types.ts`：

```ts
/**
 * 进程 cwd 所属 Git 仓库的身份（B，按需解析）。
 * 纯 fs 文件解析，不 spawn git。
 *
 * - gitRoot：`.git` 所在的工作树根目录（规范化路径）。
 * - commonDir：共享 git 元数据目录（普通仓库=gitRoot/.git；worktree=主仓库 .git）。
 * - branch：当前分支名（detached HEAD 时为 null）。
 * - head：HEAD 提交 SHA 或短引用（如 "ref: refs/heads/main" 解析后的分支名对应 SHA）。
 * - detached：是否处于 detached HEAD。
 * - isWorktree：是否为 `git worktree add` 创建的链接工作树。
 * 解析失败（非 git 目录/权限/边界情况）→ 整个 fetchGitIdentity 返回 null。
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

`ExposedApi` 新增：

```ts
// null = 非 git 目录 / 解析失败 / cwd 无效。纯 fs 解析，不 spawn git。
fetchGitIdentity(cwd: string): Promise<GitIdentity | null>;
```

**输入来源决策**：接受 `cwd: string` 参数（非 pid），由渲染层用 `preciseCwdByPid[pid] ?? proc.cwd` 传入。理由：
- 省一次 native PEB 行走（main 不必再调 `readProcessCwd`）。
- 更纯（不依赖 pid 时效性）。
- cwd 为空（启发式抽不到）时 main 直接返回 null，无需特殊处理。

---

## 3. 解析算法（纯函数，TDD 核心）

新建 `app/src/lib/gitWorkspace.ts`，导出 `resolveGitIdentity(cwd: string): GitIdentity | null`。纯函数（只依赖 `fs`/`path`），可 TDD。

### 3.1 向上递归找 `.git`

```ts
function findGitDir(startDir: string): { gitEntry: string; treeRoot: string } | null {
  let dir = normPath(startDir);
  const root = path.parse(dir).root;  // 盘符根，防无限上溯
  while (dir !== root && dir) {
    const dotGit = path.join(dir, '.git');
    if (fs.existsSync(dotGit)) return { gitEntry: dotGit, treeRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;  // 防死循环
    dir = parent;
  }
  return null;
}
```

### 3.2 区分普通仓库 / worktree

- `.git` 是**目录** → 普通仓库。`commonDir = gitEntry`。`gitRoot = treeRoot`。`isWorktree = false`。
- `.git` 是**文件**（内容 `gitdir: <path>`） → 链接工作树。
  - 读文件首行，正则提取 `gitdir:` 后路径。
  - 该路径形如 `<mainRepo>/.git/worktrees/<name>`。
  - `commonDir` = 该路径的 `commondir` 文件内容（若存在），否则回退到 `<mainRepo>/.git`。
  - `gitRoot = treeRoot`（当前工作树根）。
  - `isWorktree = true`。

### 3.3 解析 HEAD（branch / detached）

读 `<commonDir>/HEAD`：
- 内容形如 `ref: refs/heads/<branch>` → `branch = <branch>`，`detached = false`。
- 内容是 40 字符 SHA → `detached = true`，`branch = null`，`head = SHA`。
- `head` 字段：非 detached 时取 `ref:` 后的完整引用路径（`refs/heads/main`）；detached 时取 SHA。

### 3.4 规范化

- 所有路径经 `normPath`（复用 `projectGroup.ts:13` 的逻辑，或提取共享）。大写盘符 + 正斜杠。
- 不 `realpathSync`（保留用户视角路径；UNC/junction 的 .git 查找用原路径，找不到即 null）。

### 3.5 降级条件（返回 null）

- `findGitDir` 未找到 `.git`（非 git 目录）。
- cwd 为空 / 不是绝对路径。
- `.git` 文件内容格式不符（非 `gitdir:` 开头）。
- `HEAD` 读失败 / 格式不符。
- submodule（`.git` 文件内容是 `gitdir: ../.git/modules/...`）→ 首轮返回 null（边界，留后续）。

---

## 4. IPC 接线（4 处，无 native）

照搬 `FETCH_CWD` 范式（调研报告 §6.1 已核实）：

1. **`ipc-types.ts`**：`IPC.FETCH_GIT_IDENTITY: 'git:fetchIdentity'` + `GitIdentity` 类型 + `ExposedApi.fetchGitIdentity`。
2. **`main.ts`**：
   ```ts
   ipcMain.handle(IPC.FETCH_GIT_IDENTITY, async (_evt, cwd: string) => {
     try {
       return resolveGitIdentity(cwd);  // 纯函数在 gitWorkspace.ts，main import 它
     } catch (e) {
       console.error('fetchGitIdentity failed:', e);
       return null;
     }
   });
   ```
   注意：`resolveGitIdentity` 放 `app/src/lib/gitWorkspace.ts`，main import 它。但 main（`app/electron/`）import 渲染层 `app/src/lib/` **违反边界红线**（AGENTS.md §3：main 不 import 渲染层）。

   **修正决策**：`resolveGitIdentity` 纯函数放在 `app/electron/gitWorkspace.ts`（main 域），渲染层测试通过相对路径 import 它（`../../electron/gitWorkspace`）。既有范式：`ipc-types.ts` 就在 `app/electron/` 且被渲染层 import（`ipc.ts:1`）。✓ 不违反边界。

3. **`preload.ts`**：`fetchGitIdentity: (cwd: string) => ipcRenderer.invoke(IPC.FETCH_GIT_IDENTITY, cwd)`。
4. **`ipc.ts`**：`async fetchGitIdentity(cwd: string) { return window.codemgr.fetchGitIdentity(cwd); }`。

---

## 5. 缓存与消费

### 5.1 store 缓存（仿 `preciseCwdByPid`）

`processPanelStore.ts` 新增：

```ts
gitIdentityByPid: Record<number, GitIdentity | null>;  // null=已解析但非 git
setGitIdentity: (pid: number, identity: GitIdentity | null) => void;
```

- 随 pidSet 清理（与 `preciseCwdByPid` 同 prune 逻辑，`processPanelStore.ts:92-97`）。
- 不持久化（运行时态）。
- null 也要缓存（已解析为非 git，避免重复 IPC）。

### 5.2 侧栏触发（ProcessDetailSidebar）

与 `loadCwd()`（`ProcessDetailSidebar.tsx:64-88`）同构：
- 新增 `loadGitIdentity()`：命中缓存直接用，未命中取 cwd（`preciseCwdByPid[pid] ?? proc.cwd`），调 `ipc.fetchGitIdentity(cwd)`，写回 store。
- pid 变化时重置 local loading/error 态（复用 `:29-41` 的 pid 变化 effect）。
- 展示：cwd 信息块下方新增"Git"块：
  - 非 git（identity === null 且已解析）：显示"非 Git 仓库"。
  - git：`branch`（或 `detached @ <sha 短>`）、`gitRoot`（可截断）、`isWorktree` 徽章。
  - 按钮"解析 Git 身份"（与"读取精确工作目录"并列），触发按需拉取。

### 5.3 精确 cwd 依赖

Git 解析依赖 cwd 准确性。启发式 cwd 可能是脚本目录而非真 cwd。**侧栏先确保精确 cwd 已拉取**（若 `preciseCwdByPid[pid]` 未命中且 proc.cwd 为空，Git 解析按钮可先提示"先读取工作目录"或自动级联拉 cwd 再拉 git）。**决策：自动级联**——`loadGitIdentity` 内部若 cwd 为空先 await `fetchCwd`，简化用户操作。

---

## 6. 测试策略

### 6.1 纯函数 TDD（`app/tests/gitWorkspace.test.ts`）

`resolveGitIdentity` 用 `os.tmpdir()` 造 fixture（实现期创建，spec 只列用例）：
1. 普通 git 仓库（`.git` 目录 + `HEAD: ref: refs/heads/main`）→ branch=main, detached=false, isWorktree=false。
2. detached HEAD（`HEAD: <40-char-sha>`）→ branch=null, detached=true。
3. 链接 worktree（`.git` 文件 `gitdir: <path>`）→ isWorktree=true。
4. 非 git 目录 → null。
5. 空 cwd → null。
6. 嵌套子目录（cwd 在 gitRoot 下两层）→ 向上找到 .git。
7. `commondir` 文件存在 → commonDir 指向主仓库。
8. `.git` 文件格式不符（非 `gitdir:`）→ null。

### 6.2 mock 同步（`app/tests/setup.ts`）

`mockIpc` 加：`fetchGitIdentity: vi.fn(() => Promise.resolve(null))`。

### 6.3 侧栏组件（人工验收）

侧栏 Git 块的 idle/loading/error/done 四态由人工验收（jsdom 难模拟 fs，且 fixture 在真实 fs）。

### 6.4 回归保护

`projectGroup.test.ts` 全绿（证明分组未被 B 影响）。

---

## 7. 风险与回滚

- **风险：低**。纯 main + 渲染层，无 native/ABI/热路径改动。最大风险是 `.git` 解析的边界情况（worktree common dir、UNC）——由 null 降级兜底。
- **回滚**：纯 TS，单 commit 可回退。IPC 通道是新增（非修改既有），零回归面。

---

## 8. 路线衔接

- **D（诊断导出）**：诊断包含 `workspace: { gitRoot, branch, head }`——直接复用 `GitIdentity`。
- **E（AI Session）**：session 可按 gitRoot 归属（同 repo 进程聚合），但本 spec 不实现聚合，只提供数据。
- **A2**：A2 的 `CollectResult` 与 B 无依赖，可并行/任意顺序。
