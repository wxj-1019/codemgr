# CodeMgr E2 — SessionPanel UI + 聚合 + 停止（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：E1（session 归属算法）的消费层；依赖 E1 + C（focusStore）。
> 方法：brainstorming skill（调研 mosaic 挂载/hook 范式/killTree IPC → 决策点可从架构推断 → 设计锁定）。

---

## 0. 背景与定位

E1 提供了 session 归属引擎（buildSessions）和数据 store（sessionStore）。E2 是它的**用户可见层**：一个 SessionPanel，把 AI 会话以列表展示，每个 session 显示聚合资源（CPU/内存/进程数/端口）、支持聚焦联动、支持 session 级停止（killTree）。

E2 让"按一次 AI 会话看资源并整体停止"成为现实——这是 CodeMgr 区别于通用监视器的核心差异化能力。

---

## 1. 范围

### 1.1 包含

- **新面板 'sessions'**：挂进 mosaic（与 port/process/perf/snapshot 并列）。
- **useSessions hook**：订阅 processPanelStore.processes（已有轮询），每次刷新调 buildSessions → sessionStore.setSessions。不新增轮询器。
- **SessionPanel 组件**：
  - 列表展示每个 session：根进程名/label、进程数、聚合 CPU%、聚合内存、监听端口数。
  - 聚焦联动：点击 session → focusSession(id) + focus(rootPid) → 进程表定位 + 侧栏跟随。
  - session 级停止：每个 session 一个"停止"按钮 → ConfirmDialog → killTree(rootPid)。
  - 空态：无 AI 进程时显示提示。
- **mosaic 注册**：layoutStore 的 BuiltInPanelId 加 'sessions'，App.tsx 加 renderTile 分支 + 标题。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/src/store/layoutStore.ts` | BuiltInPanelId 加 'sessions' + isBuiltIn 守卫 |
| `app/src/App.tsx` | BUILTIN_TITLES + ALL_BUILTIN + renderTile 分支 |
| `app/src/hooks/useSessions.ts`（新建） | 订阅 processes → buildSessions → setSessions |
| `app/src/components/SessionPanel.tsx`（新建） | 列表 + 聚合 + 聚焦 + 停止 |
| `app/tests/sessionAggregate.test.ts`（新建） | 聚合纯函数 TDD |

### 1.3 明确不做

- **不新增轮询**。useSessions 订阅 processPanelStore（已轮询），无独立 interval。
- **不做 session 历史/时间线**（留 v2）。
- **不做 session 内进程列表展开**（MVP 只显示聚合数；展开留后续）。
- **不持久化 session 面板布局偏好**（layoutStore 已 persist root 树，sessions 自然包含）。
- **不改 buildSessions**（E1 已定）。
- **不做 GPU 聚合**（MVP 先 CPU/内存/端口；GPU perProcess 多 adapter 去重复杂，留后续）。

### 1.4 成功标准

- mosaic 可添加 'sessions' 面板，显示当前 AI 会话列表。
- 每个 session 显示：根名/label、进程数、聚合 CPU%、聚合内存、监听端口数。
- 点击 session → 进程表定位到根进程 + 侧栏跟随。
- "停止"按钮 → 确认 → killTree(rootPid) → session 消失（下次刷新）。
- 无 AI 进程 → 空态提示。
- 既有测试全绿 + 聚合纯函数 TDD。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- 无 IPC / native 改动（killTree 复用既有）。

---

## 2. 聚合纯函数（TDD）

新建 `app/src/lib/sessionAggregate.ts`：

```ts
import type { ProcessInfo, NetConnection, CpuUsage } from '../../electron/ipc-types';
import { isListenLike } from './portFilter';

export interface SessionAggregate {
  processCount: number;
  totalCpu: number;        // sum of cpuPercent over session pids
  totalMemory: number;     // sum of workingSetBytes
  listenPortCount: number; // listening ports owned by session pids
}

/**
 * 聚合一个 session 的资源（E2）。纯函数，O(session pids)。
 * 输入 session pids + 全量数据源（按 pid 索引），输出聚合。
 */
export function aggregateSession(
  pids: number[],
  processes: ProcessInfo[],
  cpuMap: Record<number, number>,
  connections: NetConnection[],
): SessionAggregate {
  const pidSet = new Set(pids);
  let totalMemory = 0;
  for (const p of processes) {
    if (pidSet.has(p.pid)) totalMemory += p.workingSetBytes;
  }
  let totalCpu = 0;
  for (const pid of pids) totalCpu += cpuMap[pid] || 0;
  let listenPortCount = 0;
  for (const c of connections) {
    if (pidSet.has(c.pid) && isListenLike(c)) listenPortCount++;
  }
  return { processCount: pids.length, totalCpu, totalMemory, listenPortCount };
}
```

---

## 3. useSessions hook

新建 `app/src/hooks/useSessions.ts`：

```ts
import { useEffect } from 'react';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useSessionStore } from '../store/sessionStore';
import { buildSessions } from '../lib/sessionAttribution';

/**
 * 订阅 processPanelStore.processes（已有轮询），每次刷新调 buildSessions 写入 sessionStore。
 * 不新增轮询器——复用进程面板的 processScan 节奏（E2 spec §1.3）。
 */
export function useSessions() {
  const processes = useProcessPanelStore((s) => s.processes);
  const setSessions = useSessionStore((s) => s.setSessions);
  useEffect(() => {
    setSessions(buildSessions(processes));
  }, [processes, setSessions]);
}
```

SessionPanel 挂载时调 `useSessions()` 启动订阅。

---

## 4. SessionPanel 组件

新建 `app/src/components/SessionPanel.tsx`：

- `useSessions()` 启动订阅。
- 从 sessionStore 读 sessions；从 processPanelStore 读 processes/cpuMap；从 portRadarStore 读 connections。
- 每个 session 渲染一行卡片：
  - 标题：rootLabel（如 'Codex CLI'）+ rootPid + kind 徽章。
  - 聚合：进程数 · CPU% · 内存 · 端口数（用 aggregateSession + formatBytes）。
  - 操作：「聚焦」（focusSession + focus rootPid）+「停止」（ConfirmDialog → killTree）。
- 空态：sessions.length === 0 → "未检测到 AI 开发会话（Codex/Claude/Aider 等运行时会出现在此）"。
- focusedSessionId 高亮：当前聚焦的 session 卡片加边框。

### 4.1 停止流程

```ts
async function stopSession(rootPid: number) {
  setKillBusy(true);
  try {
    const killed = await ipc.killTree(rootPid);
    // killTree 返回杀掉的进程数；下次 processScan 刷新后 session 自然消失
    if (killed === 0) alert('未结束任何进程：根进程可能受保护、权限不足或已退出');
  } catch (e) {
    alert(`停止会话失败：${String(e)}`);
  } finally {
    setKillBusy(false);
    setPendingStop(null);
  }
}
```

复用 ProcessPanel 的 ConfirmDialog 模式（pendingStop state + busy 防连点）。

### 4.2 聚焦联动

点击 session 卡片：
- `focusSession(session.id)`（sessionStore + focusStore 都设）。
- `focus(session.rootPid, 'process')`（让进程表定位到根进程 + 侧栏跟随，复用 C）。

---

## 5. mosaic 注册

### 5.1 layoutStore

`BuiltInPanelId` 加 `'sessions'`：
```ts
export type BuiltInPanelId = 'port' | 'process' | 'perf' | 'snapshot' | 'sessions';
```
`isBuiltIn` 守卫加 `id === 'sessions'`。

### 5.2 App.tsx

- `BUILTIN_TITLES` 加 `sessions: 'AI 会话'`。
- `ALL_BUILTIN` 加 `'sessions'`。
- renderTile 加 `{id === 'sessions' && <SessionPanel />}`。

---

## 6. 测试策略

### 6.1 aggregateSession TDD（`sessionAggregate.test.ts`）

1. 单进程 session → processCount=1, totalCpu/cpuMap 值, totalMemory/workingSet, 无端口。
2. 多进程 → sum 正确。
3. 端口：session 拥有 LISTENING 端口 → listenPortCount 正确；非监听端口不计。
4. 端口属于其他 pid → 不计入。
5. cpuMap 缺某 pid → 按 0。

### 6.2 SessionPanel（人工验收）

列表/聚焦/停止需真实交互 + 真实进程，jsdom 难覆盖；由聚合纯函数测试 + 既有组件范式保证。

### 6.3 回归

layoutStore 测试（isBuiltIn 守卫等）需更新覆盖 'sessions'。

---

## 7. 风险与回滚

- **风险：低**。纯渲染层 + 新面板，killTree 复用既有 IPC。最大风险是 mosaic 注册遗漏（isBuiltIn/createNode）。
- **回滚**：纯新增 + 定点注册，单 commit 可回退。

---

## 8. 路线衔接

- **F1**：profile 启动的进程作为权威种子注入 buildSessions 后，SessionPanel 自动显示。依赖 E1+E2。
- **F2**：Dev Service 端口意图复用 aggregateSession 的端口聚合。依赖 E2。
