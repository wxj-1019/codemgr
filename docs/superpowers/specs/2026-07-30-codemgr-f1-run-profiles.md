# CodeMgr F1 — Run Profiles + 受控启动/停止（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：审查报告产品能力增强方向 F 的第一半；依赖 B（workspace 可选，profile 可关联 cwd）。
> 方法：brainstorming skill（调研 → 核心决策点确认：白名单可执行名 → 设计锁定）。
> 产品决策（用户确认 2026-07-30）：**spawn 命令限白名单可执行名**（node/npm/pnpm/yarn/python/git），用 `execFile`（无 shell）传 args 数组。命令注入面最小。

---

## 0. 背景与定位

CodeMgr 至此只能"观察 + 清理"进程，不能"启动"。AI 开发者高频场景是"从这个 worktree 启动 pnpm dev / backend / ollama sidecar"，目前得切到终端手动跑。F1 让 CodeMgr 能受控启动/停止/重启一组开发服务，闭环"启动 → 运行 → 停止 → 再启动"。

F1 是应用首次引入 **main 进程 child_process spawn** 能力。安全是第一约束：命令文本永不下发渲染层，spawn 在 main 执行，可执行名限白名单，args 用数组不经 shell。

---

## 1. 范围

### 1.1 包含

- **RunProfile 模型**：`{ id, name, command, args, cwd, expectedPorts? }`。
  - `command`：白名单可执行名（node/npm/pnpm/yarn/python/git）。
  - `args`：字符串数组（不经 shell）。
  - `cwd`：绝对路径（spawn 工作目录）。
  - `expectedPorts`：预留 F2（端口意图），F1 不消费。
- **持久化**：`userData/run-profiles.json`（仿 plugins.json 单文件），main 读写，渲染层只拿校验过的列表。
- **受控启动**：`startProfile(profileId)` → main 读 profile → execFile(command, args, {cwd}) → 持有 ChildProcess → 返回 `{runId, pid}`。
- **run 状态跟踪**：main 持 `Map<runId, RunState>`，监听 child exit → 经 IPC 事件推送 `{runId, exitCode}` 给渲染层。
- **停止**：`stopProfile(runId)` → killTree(run.pid)（复用既有 native killTree，天然过保护名单 + 收集后代）。
- **重启**：`restartProfile(runId)` → stop + start（仅 CodeMgr 启动的 run 可靠重启）。
- **RunProfilesPanel**：mosaic 面板，列出 profiles + 运行中 runs，启动/停止/重启按钮。
- **profile 增删**：UI 编辑器（RunProfileEditor）→ 经 main 校验 + 写文件。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/electron/runProfiles.ts`（新建） | profile 读写 + spawn + run 状态管理（main 域纯逻辑，可单测） |
| `app/electron/ipc-types.ts` | RunProfile/RunState 类型 + IPC 通道常量 + ExposedApi |
| `app/electron/main.ts` | 注册 run profile handlers + import runProfiles |
| `app/electron/preload.ts` | start/stop/restart/list/save/delete profile 封装 |
| `app/src/lib/ipc.ts` | 渲染层薄封装 + onRunUpdate 事件订阅 |
| `app/src/store/runProfileStore.ts`（新建） | profiles 列表 + runs 运行态 + 持久化偏好 |
| `app/src/components/RunProfilesPanel.tsx`（新建） | 面板 UI |
| `app/src/components/RunProfileEditor.tsx`（新建） | 增删 profile 编辑器 |
| `app/src/hooks/useRunProfiles.ts`（新建） | 拉取 profiles + 订阅 run 状态事件 |
| `app/src/store/layoutStore.ts` + `App.tsx` | 注册 'run-profiles' 面板 |
| `app/tests/setup.ts` | mockIpc 补 run profile 方法 |
| `app/tests/runProfiles.test.ts`（新建） | main 域纯逻辑（白名单校验、profile schema）TDD |

### 1.3 明确不做

- **F2 的端口意图/健康检测**（expectedPorts 字段预留但不消费）。
- **不做 stdout/stderr 捕获展示**（stdio 用 'ignore' 或 pipe 但不显示；终端复刻不做）。
- **不自动重启崩溃的 run**（用户手动 restart；自动重启留后续）。
- **不恢复外部启动的进程**（只对 CodeMgr 自己 startProfile 启动的 run 保证 restart 可靠）。
- **不做 profile 导入导出**（留后续）。
- **不改 native**（killTree 复用既有；spawn 是 Node child_process，不进 native）。

### 1.4 成功标准

- 创建一个 profile（如 `{name:'前端', command:'pnpm', args:['dev'], cwd:'E:\\repo\\app'}`）。
- 启动 → 拿到 pid → 该进程出现在进程面板（被 processScan 捕获）。
- 运行中状态在 RunProfilesPanel 可见（running 徽章 + pid）。
- 停止 → killTree(pid) → 进程消失 → run 状态变 exited。
- 重启 → 先停再启，拿到新 pid。
- profile 持久化（重启 CodeMgr 后仍在）。
- 白名单外 command（如 'calc'）→ 启动被拒。
- 既有测试全绿 + 白名单/schema 纯逻辑 TDD。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- native 零改动（spawn 是 Node；killTree 复用）。

---

## 2. 数据模型（`ipc-types.ts`）

```ts
/** 允许的可执行名白名单（F1 安全模型：用户确认）。 */
export const RUN_COMMAND_WHITELIST: ReadonlySet<string> = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'py', 'git',
]);

export interface RunProfile {
  id: string;            // uuid，main 生成
  name: string;          // 用户命名（如 '前端 dev'）
  command: string;       // 白名单可执行名（如 'pnpm'）
  args: string[];        // 参数数组（不经 shell）
  cwd: string;           // 绝对路径
  expectedPorts?: number[]; // 预留 F2（端口意图），F1 不消费
}

/** 一个运行中的 profile 实例（main spawn 后产生）。 */
export interface RunState {
  runId: string;         // uuid，main 生成（一次启动一个）
  profileId: string;     // 关联的 profile
  pid: number;           // spawn 返回的根 pid
  status: 'running' | 'exited';
  exitCode: number | null; // exited 时填
  startedAt: number;
}
```

---

## 3. runProfiles.ts（main 域逻辑，TDD 核心）

新建 `app/electron/runProfiles.ts`。把可单测的纯逻辑抽出（不依赖 Electron app/ipcMain）：

### 3.1 profile 读写

```ts
export function validateProfile(x: unknown, whitelist: ReadonlySet<string>): RunProfile | null {
  // schema 校验：id/name/command/args/cwd 类型 + command 在白名单 + cwd 绝对路径
  // 任一不符返回 null（main handler catch 后降级）
}
```

### 3.2 白名单校验

`validateProfile` 内 `whitelist.has(command)` —— 非白名单 → null。这是命令注入防护的核心。

### 3.3 spawn + run 状态（main 运行时，非纯函数）

main 持 `Map<runId, { child: ChildProcess; state: RunState }>`：
- start：`execFile(command, args, { cwd, shell: false })` → child.pid → 存 Map → 监听 `child.on('exit', ...)` → 更新 status=exited + exitCode → 推 IPC 事件。
- stop：取 run 的 pid → 调 native killTree(pid)（复用既有，过保护名单 + 收集后代）。
- restart：stop（等 exit）+ start。

**execFile vs spawn**：用 `execFile`（等价 spawn with shell:false + Promise 化），关键是不经 shell 解释器，args 数组直接传，杜绝 `; & | $` 注入。

### 3.4 args 安全

args 是字符串数组，不经 shell。但单个 arg 可能含恶意内容——白名单 command 已限死入口（node/npm 等），args 是它们的参数（如 `['dev']`、`['server.js']`）。**不额外过滤 args**（用户配置受信任，且不经 shell 无拼接注入面）。文档化此决策。

---

## 4. IPC 接线

### 4.1 通道（`ipc-types.ts`）

```ts
RUN_PROFILE_LIST: 'run:list',
RUN_PROFILE_SAVE: 'run:save',       // 新建/更新（main 生成 id）
RUN_PROFILE_DELETE: 'run:delete',
RUN_START: 'run:start',             // profileId → {runId, pid}
RUN_STOP: 'run:stop',               // runId → killed count
RUN_RESTART: 'run:restart',         // runId → new {runId, pid}
RUN_UPDATE: 'run:update',           // 事件（非 invoke）：{runId, status, exitCode}
```

### 4.2 ExposedApi

```ts
listRunProfiles(): Promise<RunProfile[]>;
saveRunProfile(profile: Omit<RunProfile, 'id'> & { id?: string }): Promise<RunProfile | null>;
deleteRunProfile(id: string): Promise<boolean>;
startProfile(profileId: string): Promise<{ runId: string; pid: number } | null>;
stopProfile(runId: string): Promise<number>;
restartProfile(runId: string): Promise<{ runId: string; pid: number } | null>;
onRunUpdate(cb: (update: RunState) => void): () => void;  // 事件订阅，返回取消函数
```

### 4.3 main handler 范式

照搬 snapshot handler 范式（catch → 降级值）：
- list：读 run-profiles.json → 逐条 validateProfile → 过滤 null。
- save：validateProfile → 通过则写文件（id 用 randomUUID）。
- start：读 profile → execFile → 存 Map → 返回 {runId, pid}。
- stop/restart：查 Map → killTree/execFile。

### 4.4 事件推送（仿 DATA_SOURCE_RESULT）

main `webContents.send(IPC.RUN_UPDATE, runState)`；preload `onRunUpdate` 用 `ipcRenderer.on` + 返回取消订阅函数（与 onDataSourceResult 同构）。

---

## 5. 渲染层

### 5.1 runProfileStore

`profiles: RunProfile[]` + `runs: RunState[]`（运行中实例）。profiles 不持久化在 store（main 文件是真理之源，启动时 list 拉取）。runs 是运行时态。

### 5.2 useRunProfiles hook

挂载时 `listRunProfiles()` → store；订阅 `onRunUpdate` → 更新 runs。卸载时取消订阅。

### 5.3 RunProfilesPanel

mosaic 面板：
- 列表每个 profile：name + command + args 摘要 + 运行状态（若有 run → running 徽章 + pid；无 → idle）。
- 按钮：启动（idle 时）/ 停止（running 时）/ 重启（running 时）。
- 顶部"新建 profile"按钮 → RunProfileEditor。

### 5.4 RunProfileEditor

模态编辑器：name/command（下拉白名单）/args（逗号或空格分隔输入→数组）/cwd（文本框）。保存 → saveRunProfile。

---

## 6. 测试策略

### 6.1 纯逻辑 TDD（`runProfiles.test.ts`）

`validateProfile` 用例：
1. 合法 profile（白名单 command + 绝对 cwd + args 数组）→ 返回 profile。
2. 非白名单 command（'calc'）→ null。
3. cwd 非绝对 → null。
4. args 非数组 → null。
5. name 空 → null。

### 6.2 main handler / spawn（人工 + 集成）

spawn 真实进程需 Electron 环境，jsdom 无法测。由纯逻辑校验 + 人工验收保证。可参照 native killTree 测试范式（真实 spawn node -e setTimeout）在 main 集成测试覆盖，但首版以人工验收为主。

### 6.3 mockIpc 同步

`setup.ts` 补 listRunProfiles/saveRunProfile/deleteRunProfile/startProfile/stopProfile/restartProfile/onRunUpdate 默认 mock。

### 6.4 回归

既有测试全绿（纯新增 + IPC 接线）。

---

## 7. 安全性论证

- **命令文本永不下发渲染层**：渲染层只传 profileId，main 读文件执行（与 listPlugins 范式一致）。
- **白名单可执行名**：`RUN_COMMAND_WHITELIST`，validateProfile 强校验。
- **execFile 无 shell**：args 数组直接传，不经 shell 解释器，无 `; & | $` 注入面。
- **不暴露 ipcRenderer/child_process**：preload 只暴露封装方法。
- **cwd 绝对路径**：path.isAbsolute 校验。
- **killTree 保护名单**：stop 复用 native killTree，svchost/system 等受保护（profile 启动的 node/pnpm 不在名单，符合预期可被停）。

---

## 8. 风险与回滚

- **风险：中**。首次引入 spawn，但白名单 + execFile 无 shell 把注入面压到最小。主要风险是 Windows 进程组/控制台进程的退出行为（cmd /c 包装）——白名单的 node/npm 直接 execFile 不经 cmd，行为较可控。
- **缓解**：stop 用 killTree（收集后代，防孤儿）；run 状态事件让 UI 可见退出。
- **回滚**：纯新增文件 + IPC 接线，单 commit 可回退。

---

## 9. 路线衔接

- **F2**：消费 expectedPorts 字段 → 端口意图 + 健康检测（就绪/冲突/退出状态）。依赖 F1。
- **E**：F1 启动的进程可被 buildSessions 识别（若它是 AI 种子）；F1 的 run.rootPid 可作为权威种子注入 E（后续增强）。
