# CodeMgr F2 — Dev Service 端口意图 + 健康检测（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：F1（RunProfile.expectedPorts）+ E（端口聚合）；依赖 F1。
> 方法：brainstorming skill（调研 → 决策点可从架构推断 → 设计锁定）。

---

## 0. 背景与定位

F1 让 CodeMgr 能启动开发服务，但启动后"服务就绪了吗？端口冲突了吗？"仍不可见。F2 消费 F1 profile 的 `expectedPorts` 字段，对照端口雷达的实际监听状态，给出每个 run 的服务健康状态：free / listening / conflict / exited。

这让"启动 → 就绪 → 冲突 → 退出"全链路可见，是 Run Profiles 的体验闭环。

---

## 1. 范围

### 1.1 包含

- **服务状态纯函数** `resolveServiceStatus(run, profile, connections)`：输入 run（pid）+ profile（expectedPorts）+ 全量端口，输出状态。
  - `exited`：run.status === 'exited'。
  - `listening`：expectedPorts 全部被某进程监听（run.pid 或其后代）。
  - `starting`：run running 但端口未全部监听。
  - `conflict`：expectedPort 被其他 pid（非本 run）占用。
  - `no-ports`：profile 无 expectedPorts（不检测）。
- **RunProfilesPanel 增强**：每个 running run 显示服务状态徽章（listening/starting/conflict/exited）+ 端口明细。
- **冲突提示**：conflict 时显示占用端口的 pid/name。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/src/lib/devService.ts`（新建） | resolveServiceStatus 纯函数 + ServiceStatus 类型 |
| `app/src/components/RunProfilesPanel.tsx` | 消费 resolveServiceStatus 显示状态徽章 |
| `app/tests/devService.test.ts`（新建） | 纯函数 TDD |

### 1.3 明确不做

- **不做 HTTP 健康检测**（GET /health）——MVP 只用端口监听判定就绪。HTTP 探测留后续。
- **不做自动重启/自动冲突解决**——只提示，用户手动处理。
- **不改 F1 的 profile 模型**——expectedPorts 已预留，F2 只消费。
- **不做跨 run 端口冲突聚合面板**——只在每个 run 行内显示。

### 1.4 成功标准

- profile 带 expectedPorts=[5173]，run 启动后端口被监听 → 状态 listening（绿）。
- 端口被其他 pid 占 → conflict（红）+ 显示占用者。
- run running 但端口未监听 → starting（黄）。
- run exited → exited（灰）。
- profile 无 expectedPorts → no-ports（不显示状态徽章）。
- 既有测试全绿 + 纯函数 TDD。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- 无 IPC/native/main 改动（F2 纯渲染层 + 纯函数）。

---

## 2. 数据模型

`app/src/lib/devService.ts`：

```ts
import type { RunState, RunProfile, NetConnection } from '../../electron/ipc-types';
import { isListenLike } from './portFilter';

export type ServiceStatusKind = 'exited' | 'listening' | 'starting' | 'conflict' | 'no-ports';

export interface ServiceStatus {
  kind: ServiceStatusKind;
  /** 每个 expectedPort 的占用情况（kind=listening/conflict 时填）。 */
  ports?: Array<{ port: number; heldBy: number | null; conflict: boolean }>;
}

/**
 * 判定一个 run 的开发服务健康状态（F2）。纯函数。
 * - exited: run 已退出。
 * - no-ports: profile 无 expectedPorts。
 * - listening: 所有 expectedPort 被监听（任意 pid）。
 * - conflict: 某 expectedPort 被非本 run 的 pid 监听。
 * - starting: run running，端口未全部监听，且无冲突。
 */
export function resolveServiceStatus(
  run: RunState,
  profile: RunProfile,
  connections: NetConnection[],
): ServiceStatus {
  if (run.status === 'exited') return { kind: 'exited' };
  const expected = profile.expectedPorts ?? [];
  if (expected.length === 0) return { kind: 'no-ports' };

  // 监听端口 → 持有 pid 映射
  const listeningByPort = new Map<number, number[]>();
  for (const c of connections) {
    if (isListenLike(c)) {
      const arr = listeningByPort.get(c.localPort) ?? [];
      arr.push(c.pid);
      listeningByPort.set(c.localPort, arr);
    }
  }

  const ports = expected.map((port) => {
    const holders = listeningByPort.get(port) ?? [];
    const heldBy = holders.length > 0 ? holders[0] : null;
    const conflict = holders.length > 0 && !holders.includes(run.pid);
    return { port, heldBy, conflict };
  });

  const hasConflict = ports.some((p) => p.conflict);
  const allListening = ports.every((p) => p.heldBy !== null);

  if (hasConflict) return { kind: 'conflict', ports };
  if (allListening) return { kind: 'listening', ports };
  return { kind: 'starting', ports };
}
```

---

## 3. RunProfilesPanel 增强

在 running run 行内，调 resolveServiceStatus，显示状态徽章：
- `listening` → 绿色 "就绪"
- `starting` → 黄色 "启动中…"
- `conflict` → 红色 "端口冲突" + 悬停显示占用 pid
- `exited` → 灰色 "已退出"
- `no-ports` → 不显示

RunProfilesPanel 已有 run（RunState）+ profile（RunProfile）+ connections（从 portRadarStore）。加一个 portRadarStore connections 读取 + 状态徽章渲染。

---

## 4. 测试策略

### 4.1 resolveServiceStatus TDD（`devService.test.ts`）

1. exited run → exited。
2. 无 expectedPorts → no-ports。
3. expectedPort 被本 run pid 监听 → listening。
4. expectedPort 被其他 pid 监听 → conflict + ports.conflict=true。
5. expectedPort 未被监听（run running）→ starting。
6. 多端口：一个 listening 一个未监听 → starting（未全就绪）。
7. 多端口：一个 conflict → conflict。
8. 非 listening 态连接（ESTABLISHED）不计入。

### 4.2 回归

既有测试全绿（F2 纯新增 + Panel 增强）。

---

## 5. 风险与回滚

- **风险：低**。纯函数 + Panel 徽章渲染，无 IPC/native/main 改动。
- **回滚**：纯新增，单 commit 可回退。

---

## 6. 路线衔接

- F2 是 roadmap F 的收尾。A1-F2 全部完成后，CodeMgr 具备：观察（进程/端口/性能）、清理（kill）、身份（workspace/git）、聚焦（跨面板）、诊断（导出）、AI 会话（图谱）、启动（run profiles）、服务健康（端口意图）的完整闭环。
