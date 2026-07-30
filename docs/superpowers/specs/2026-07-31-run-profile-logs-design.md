# RunProfile 日志闭环（stdout/stderr 捕获 + 日志视图）设计

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 P0-1

## 1. 问题

Run Profiles（F1）能受控启动/停止/重启开发服务，但 **不捕获 stdout/stderr**：服务报错端口占用、编译失败、依赖缺失时，用户在 CodeMgr 里看不到任何输出，只能回终端——"那为什么不直接在终端启动？"日志缺失抵消了 RunProfile 的大半价值，是开发者体验审查认定的最大断点。

## 2. 目标 / 非目标

**目标**
- main 侧捕获每个 run 的 stdout/stderr 进 ring buffer（按 run 隔离，进程退出后保留可查）。
- 渲染层在 RunProfile 行内展开日志视图：增量拉取、自动跟随滚动、可清空本地视图。
- 复用 F1 安全模型：日志只是被动捕获的子进程输出，不新增任何执行面。

**非目标（YAGNI）**
- 日志持久化到磁盘/跨 app 重启保留（内存 buffer，app 退出即弃）。
- ANSI 颜色渲染（v1 剥离 ANSI 转义，纯文本显示）。
- 日志搜索/过滤/导出（后续可复用 E 的导出通道再加）。
- 实时流推送（v1 用 2s 增量轮询，与面板既有轮询范式一致；不新增事件通道）。

## 3. main 侧设计（`app/electron/runProfiles.ts` 扩展）

### 3.1 Ring buffer（纯函数，TDD）
```ts
interface RunLogLine { seq: number; text: string }
interface LogBuffer { lines: RunLogLine[]; nextSeq: number; droppedBefore: number; pending: string }
```
- `MAX_LOG_LINES = 2000`（每 run 约 ≤400KB 内存）。
- `appendLogChunk(buf, chunk)`：`buf.pending += chunk`，按 `/[\r\n]/` 切分（`\r` 一并处理，进度条/覆盖行降级为多行纯文本），最后一段存回 `pending`（未换行的半截行）；完整行剥离 ANSI（`stripAnsi`）后带自增 `seq` 入队，超 2000 丢最老并 `droppedBefore++`。
- `flushLog(buf)`：进程退出时把非空 `pending` 落为最后一行。
- `readLog(buf, sinceSeq)` → `RunLogChunk { lines, droppedBefore, nextSeq }`：只返 `seq > sinceSeq` 的行（增量）。

### 3.2 RunManager 挂接
- `execFile` 默认 stdio 即 pipe：`child.stdout`/`child.stderr` 的 `data` 事件 → `appendLogChunk`（两个流共用同一 buffer，按到达顺序交错——不区分流来源，v1 简单优先）。
- `exit` 时 `flushLog`。
- 新增 `getLogs(runId, sinceSeq): RunLogChunk | null`（未知 runId → null）。
- buffer 生命周期 = run 在 `runs` Map 中的生命周期（stop/kill 后仍可查；app 退出即弃）。

## 4. IPC（新增 1 通道）

| 通道 | 载荷 | 返回 |
|---|---|---|
| `run:getLogs` | `runId: string, sinceSeq?: number` | `RunLogChunk \| null` |

- `RunLogChunk = { lines: { seq, text }[]; droppedBefore: number; nextSeq: number }`。
- 接线照 §10.1 食谱：ipc-types（常量 + 类型 + ExposedApi）→ preload → main handler（catch→null）→ lib/ipc。

## 5. 渲染层设计

### 5.1 累积纯函数（TDD，`app/src/lib/runLogs.ts`）
`mergeLogChunk(prev: { lines, droppedBefore, nextSeq }, chunk: RunLogChunk)`：
- 按 seq 去重（只收 `seq > prev.nextSeq` 的行），`droppedBefore` 取 chunk 值（main 侧累计真相），返回新 state。幂等：重复拉同一 chunk 不产生重复行。

### 5.2 RunLogView 组件（`app/src/components/RunLogView.tsx`）
- props：`{ runId: string }`。
- 轮询：挂载即全量拉（sinceSeq=0），之后 2s 增量（`busyRef` 防重入 + 卸载 `stoppedRef` 清理，照 §10.2 范式）。
- 视图：等宽字体 `<pre>` 滚动区（max-h-64），`droppedBefore > 0` 时顶部一条"已丢弃 N 行早期输出"提示；工具行：清空（仅本地视图）按钮 + 行数。
- 自动跟随：滚动在底部时新行到达自动 `scrollTop = scrollHeight`；用户上翻则不拽回（onScroll 记 atBottom）。
- runId 变化（重启）重置 state 重新全量拉。

### 5.3 RunProfilesPanel 集成
- 行操作区加「日志」toggle（该 profile 存在 run 记录——运行中或已退出——时可用）：展开行内 `<RunLogView runId={...} />`，取该 profile 最近一次 run（`runs.filter(profileId).at(-1)`）。
- 展开状态组件本地（`openLogFor: string | null`，一次只展开一行）。

## 6. 测试（TDD）

- `runProfiles.test.ts` 扩展：appendLogChunk 行切分/半截行 pending/`\r` 处理/ANSI 剥离/2000 上限 + droppedBefore/readLog 增量与 seq 单调/flushLog。
- `runLogs.test.ts`（渲染层）：mergeLogChunk 追加/去重/幂等/droppedBefore 更新。
- `runLogView.test.tsx`：mock `window.codemgr.getRunLogs`（照 AutoLaunchToggle 范式），断言挂载全量拉取渲染行、增量追加、"已丢弃 N 行"提示、清空按钮。
- 既有 432 测试不回归。

## 7. 验收（人工）

1. 新建 profile（如 `pnpm dev`）启动 → 展开日志 → 看到 dev server 输出滚动更新。
2. 端口冲突导致进程退出 → 日志保留，能看到报错原文。
3. 输出超 2000 行 → 顶部提示丢弃行数，最新输出持续可见。
