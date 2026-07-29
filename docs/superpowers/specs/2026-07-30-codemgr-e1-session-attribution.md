# CodeMgr E1 — Session 归属算法（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：审查报告产品能力增强方向 E 的算法核心；依赖 B（workspace 可选）/ 无 C 依赖（E2 才依赖 C）。
> 方法：brainstorming skill（调研 → 核心决策点确认：单快照 MVP → 设计锁定）。
> 产品决策（用户确认 2026-07-30）：**单快照归属**。只做瞬时 ppid 树内的后代收集，根进程退出后 session 可能丢叶节点（标注局限）。跨快照历史黏留留 v2。

---

## 0. 背景与定位

E（AI Session 图谱）的最终形态是"按一次 AI 开发会话看资源/端口并整体停止"。但 E 是工程量最大的子系统，必须分解。E1 是它的**算法核心**：从瞬时进程快照识别"哪些进程属于同一个 AI 会话"，并聚合成 session 对象。

E1 是纯函数 + 一个 store，不含 UI（UI 是 E2）。E1 可独立 TDD，是 E2/F1 的地基。

**为什么单快照够 MVP**：调研确认 killTree（`process_ops.cpp:143-178`）已证明"根进程+后代在同一瞬时快照内全存活"场景成立。AI CLI（Codex/Claude）在工作期间通常持续存活（它是交互式会话根），其后代 dev server/test runner 在其存活期间也在同一快照内。根进程退出 = 会话结束，此时丢叶节点是可接受的（会话已结束）。

---

## 1. 范围

### 1.1 包含

- **Session 归属纯函数** `buildSessions(processes, options)`：输入 ProcessInfo[]，输出 Session[]。
  - 种子识别：`labelForProcess` 判定 `kind === 'ai' | 'ai-ide'` 的进程为 session 根。
  - 后代收集：从每个种子出发，按 ppid 反向邻接 DFS 收集所有后代（复用 killTree 的遍历模式，带 visited 防环）。
  - 一个进程只属于一个 session（首种子优先；避免重叠）。
- **Session 模型**：`{ id, rootIdentity, rootPid, pids, kind, startedAt }`。
  - `rootIdentity = ${pid}:${createTimeMs}`（复用 snapshotDiff 的 identity 范式）。
  - `id` = 规范化 rootIdentity（session 本身无独立 uuid——它的身份就是根进程身份）。
- **sessionStore**：保存最近一次 `buildSessions` 的结果 + focusedSessionId（C 的 focusStore 扩展）。
  - 每次 processScan 后重算 sessions（单快照，不跨 tick 存活历史）。
  - focusedSessionId 随 session 消失自动清空。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/src/lib/sessionAttribution.ts`（新建） | `buildSessions` 纯函数 + `Session` 类型 |
| `app/src/store/sessionStore.ts`（新建） | sessions 列表 + setSessions + focusedSessionId |
| `app/src/store/focusStore.ts` | 扩展 `focusedSessionId`（平行于 focusedPid） |
| `app/tests/sessionAttribution.test.ts`（新建） | 纯函数 TDD |
| `app/tests/sessionStore.test.ts`（新建） | store TDD |

### 1.3 明确不做

- **跨快照断链补救**（历史 ppid 黏留）——留 v2，MVP 标注局限。
- **UI**（SessionPanel）——E2。
- **session 级停止**（killTree 调用）——E2（E1 只算归属，不停止）。
- **资源聚合展示**（CPU/内存/GPU/端口 sum）——E2（E1 的 Session 含 pids，聚合在 E2/UI 层做）。
- **shell/browser 显式标签**——用现有 AI 标签作种子即可，不新增标签规则。
- **多 workspace session 拆分**——一个 session 可能跨 workspace，E1 不拆。
- **F 的 profile 种子**——F1 会把 profile 启动的进程作为"权威种子"注入，但 E1 先只支持标签种子。

### 1.4 成功标准

- 给定含一个 AI 根 + 后代的进程列表 → buildSessions 输出一个 session，pids 含根 + 所有后代。
- 给定无 AI 进程的列表 → 输出空数组。
- 给定多个 AI 根（互非后代）→ 输出多个 session。
- 重叠后代（两个 AI 根共享一个后代）→ 后代归首种子，不重复。
- 防环（A.ppid==B.pid && B.ppid==A.pid）→ 不死循环。
- sessionStore setSessions + focusedSessionId 基本读写。
- 既有测试全绿。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- 无 IPC / native 改动（E1 纯渲染层 + 纯函数）。

---

## 2. 数据模型

### 2.1 Session 类型（`sessionAttribution.ts`）

```ts
import type { ProcessInfo } from '../../electron/ipc-types';

export interface Session {
  /** Session 身份 = 根进程的 pid:createTimeMs（复用 snapshotIdentity 范式）。 */
  id: string;
  /** 根进程 pid（便于 E2 调 killTree）。 */
  rootPid: number;
  /** 根进程的 label kind（'ai' | 'ai-ide'）。 */
  kind: string;
  /** 根进程显示名（如 'Codex CLI'）。 */
  rootLabel: string;
  /** 属于此 session 的所有 pid（含根）。 */
  pids: number[];
  /** 根进程创建时间（session 开始近似）。 */
  startedAt: number;
}
```

### 2.2 buildSessions 签名

```ts
export interface BuildSessionsOptions {
  /** 种子判定函数，默认用 labelForProcess 判 ai/ai-ide。可注入便于测试。 */
  isSeed?: (p: ProcessInfo) => boolean;
}

export function buildSessions(processes: ProcessInfo[], options?: BuildSessionsOptions): Session[];
```

默认 `isSeed` 调 `labelForProcess(p.name, p.cmdline)`，返回 `label?.kind === 'ai' || label?.kind === 'ai-ide'`。

---

## 3. 算法（TDD 核心）

### 3.1 步骤

1. **建 ppid 反向邻接**：`Map<number, ProcessInfo[]>`（pid → 其直接子进程）。复用 killTree（`process_ops.cpp:149-151`）与 buildTree（`ProcessTable.tsx:30-35`）的模式。
2. **识别种子**：遍历 processes，对每个调 `isSeed`，收集种子列表（保持 processScan 原顺序，确保首种子优先确定）。
3. **对每个种子 DFS 收集后代**：
   - 从种子 pid 出发，沿邻接表 DFS，带 `visited: Set<number>` 防环。
   - 收集所有可达 pid。
   - **去重**：维护全局 `claimed: Set<number>`，已被前一个 session 认领的 pid 不再认领（首种子优先）。
4. **构造 Session**：每个种子 + 其认领的 pids → Session 对象。

### 3.2 边界

- **防环**：visited 集合。即便快照出现 A.ppid==B.pid && B.ppid==A.pid（PID 复用，killTree 注释 `process_ops.cpp:173` 已提），DFS 不会死循环。
- **自引用**：`c.pid === pid` 跳过（buildTree `:42` 已有此 guard）。
- **无后代种子**：session.pids = [rootPid]（单进程 session 仍有效）。
- **种子互为后代**：若种子 B 是种子 A 的后代，B 会被 A 先认领 → B 不再作为独立种子（claimed 去重覆盖）。

### 3.3 性能

- 建邻接 O(n)；种子识别 O(n)；DFS 总计 O(n)（每 pid 至多访问一次，claimed 去重）。
- 400 进程规模无压力（processScan p99=12.38ms 红线不受影响——buildSessions 在渲染层 store，不在 native 热路径）。

---

## 4. sessionStore 设计

新建 `app/src/store/sessionStore.ts`：

```ts
import { create } from 'zustand';
import type { Session } from '../lib/sessionAttribution';

interface SessionState {
  sessions: Session[];
  focusedSessionId: string | null;
  setSessions: (s: Session[]) => void;
  setFocusedSession: (id: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  focusedSessionId: null,
  setSessions: (s) => set((prev) => ({
    sessions: s,
    // focusedSessionId 指向的 session 消失 → 清空（防指向幽灵，与 C 的 focusedPid 同模式）
    focusedSessionId: prev.focusedSessionId && s.some((x) => x.id === prev.focusedSessionId)
      ? prev.focusedSessionId : null,
  })),
  setFocusedSession: (id) => set({ focusedSessionId: id }),
  reset: () => set({ sessions: [], focusedSessionId: null }),
}));
```

**不持久化**（sessions 是运行时态；PID 跨会话无意义）。

**何时调 setSessions**：E2 的 hook（useSessions）在 processScan 后调 buildSessions → setSessions。E1 只提供 store + 纯函数，不接 hook（hook 是 E2）。

---

## 5. focusStore 扩展（C）

`app/src/store/focusStore.ts` 加 `focusedSessionId`（平行于 focusedPid）：

```ts
interface FocusState {
  focusedPid: number | null;
  focusedSessionId: string | null;  // 新增（E1）
  sourcePanel: PanelSource | null;
  focus: (pid: number | null, source?: PanelSource | null) => void;
  focusSession: (id: string | null) => void;  // 新增
}
```

focusedSessionId 与 focusedPid 独立（聚焦一个 session 不影响单进程聚焦）。

---

## 6. 测试策略

### 6.1 buildSessions TDD（`sessionAttribution.test.ts`）

1. 单 AI 根 + 2 直接子 → 1 session，pids=[root,c1,c2]。
2. 深层后代（root→a→b→c）→ pids 含全部 4 层。
3. 无 AI 进程 → []。
4. 两个独立 AI 根（非后代关系）→ 2 sessions。
5. 重叠后代（rootA 的子 x 也是 rootB 的子）→ x 归 rootA（首种子），rootB 的 pids 不含 x。
6. 防环（A.ppid=B, B.ppid=A，A 是种子）→ 不死循环，pids 合理。
7. 自引用（p.ppid===p.pid）→ 跳过，不死循环。
8. 注入 isSeed（测试不用真实 labelForProcess，用 mock 判定）→ 灵活。

测试用 ProcessInfo fixture（参照 projectGroup.test.ts 的 `p()` 工厂），不依赖真实标签规则。

### 6.2 sessionStore TDD

1. setSessions 基本。
2. focusedSessionId 指向消失的 session → 自动清空。
3. reset。

### 6.3 回归

既有测试全绿（纯新增）。

---

## 7. 风险与回滚

- **风险：低**。纯函数 + 新 store，无 IPC/native/热路径/UI 改动。最大风险是 DFS 防环遗漏 → visited 集合 + 测试覆盖。
- **回滚**：纯新增文件，单 commit 可回退。

---

## 8. 局限声明（MVP 接受）

- 根进程退出后，其后代因 ppid 断链会被当"根"→ 不再属于任何 session。MVP 接受此不完整（会话已结束）。
- wrapper shell（pnpm→node）快速退出后，孙进程 ppid 指向已消失的 wrapper → 可能丢。MVP 接受。
- E2 的 UI 应标注"session 在根进程存活期间完整"。

---

## 9. 路线衔接

- **E2**：SessionPanel（列表/资源聚合/session 级 killTree）+ useSessions hook（processScan 后调 buildSessions）。依赖 E1。
- **F1**：profile 启动的进程作为"权威种子"注入 buildSessions（比标签更精确）。依赖 E1。
- **F2**：Dev Service 端口意图用 E1 的 session.pids 聚合端口。依赖 E1/F1。
