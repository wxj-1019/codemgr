# CodeMgr E2 — SessionPanel UI + 聚合 + 停止 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 'sessions' mosaic 面板，列出 AI 会话（E1）+ 聚合资源 + 聚焦联动 + session 级 killTree 停止。

**Architecture:** aggregateSession 纯函数（TDD）聚合 session 资源；useSessions hook 订阅 processPanelStore（无新轮询）→ buildSessions → sessionStore；SessionPanel 渲染卡片列表 + 聚焦/停止；layoutStore/App 注册新面板。killTree 复用既有 IPC。

**Tech Stack:** React 18 + TypeScript + Zustand + Vitest。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-e2-session-panel.md`

**分支:** `feat/e1-session-attribution`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新建纯函数 | `app/src/lib/sessionAggregate.ts` | aggregateSession |
| 新建 hook | `app/src/hooks/useSessions.ts` | 订阅 processes → buildSessions → setSessions |
| 新建组件 | `app/src/components/SessionPanel.tsx` | 列表 + 聚合 + 聚焦 + 停止 |
| 改 | `app/src/store/layoutStore.ts` | BuiltInPanelId 加 'sessions' + isBuiltIn |
| 改 | `app/src/App.tsx` | BUILTIN_TITLES + ALL_BUILTIN + renderTile |
| 测试 | `app/tests/sessionAggregate.test.ts`（新建） | 纯函数 TDD |

---

## Task 1: aggregateSession 纯函数（TDD）

**Files:**
- Create: `app/src/lib/sessionAggregate.ts`
- Test: `app/tests/sessionAggregate.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `app/tests/sessionAggregate.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { aggregateSession } from '../src/lib/sessionAggregate';
import type { ProcessInfo, NetConnection } from '../electron/ipc-types';

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'x', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, ...over,
});
const conn = (over: Partial<NetConnection> = {}): NetConnection => ({
  protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0,
  state: 'LISTENING', pid: 1, processName: 'x', ...over,
});

describe('aggregateSession', () => {
  it('single process session', () => {
    const a = aggregateSession(
      [10],
      [proc({ pid: 10, workingSetBytes: 100 * 1024 * 1024 })],
      { 10: 5.5 },
      [],
    );
    expect(a.processCount).toBe(1);
    expect(a.totalCpu).toBe(5.5);
    expect(a.totalMemory).toBe(100 * 1024 * 1024);
    expect(a.listenPortCount).toBe(0);
  });

  it('multi process sums cpu and memory', () => {
    const a = aggregateSession(
      [10, 11],
      [proc({ pid: 10, workingSetBytes: 50 }), proc({ pid: 11, workingSetBytes: 30 })],
      { 10: 10, 11: 20 },
      [],
    );
    expect(a.processCount).toBe(2);
    expect(a.totalCpu).toBe(30);
    expect(a.totalMemory).toBe(80);
  });

  it('counts listening ports owned by session pids', () => {
    const a = aggregateSession(
      [10],
      [proc({ pid: 10 })],
      {},
      [
        conn({ pid: 10, localPort: 5173, state: 'LISTENING' }),
        conn({ pid: 10, localPort: 3000, state: 'LISTENING' }),
        conn({ pid: 10, localPort: 9999, state: 'ESTABLISHED' }), // 非监听不计
      ],
    );
    expect(a.listenPortCount).toBe(2);
  });

  it('does not count ports owned by other pids', () => {
    const a = aggregateSession(
      [10],
      [proc({ pid: 10 })],
      {},
      [conn({ pid: 99, localPort: 5173, state: 'LISTENING' })],
    );
    expect(a.listenPortCount).toBe(0);
  });

  it('missing cpuMap entry counts as 0', () => {
    const a = aggregateSession([10, 11], [proc({ pid: 10 }), proc({ pid: 11 })], { 10: 7 }, []);
    expect(a.totalCpu).toBe(7);
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/sessionAggregate.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 sessionAggregate.ts**

新建 `app/src/lib/sessionAggregate.ts`：

```ts
import type { ProcessInfo, NetConnection } from '../../electron/ipc-types';
import { isListenLike } from './portFilter';

export interface SessionAggregate {
  processCount: number;
  totalCpu: number;
  totalMemory: number;
  listenPortCount: number;
}

/**
 * 聚合一个 session 的资源（E2）。纯函数，O(session pids + connections)。
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

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/sessionAggregate.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/sessionAggregate.ts app/tests/sessionAggregate.test.ts
git commit -m "feat(app): aggregateSession pure function (E2)"
```

---

## Task 2: useSessions hook

**Files:**
- Create: `app/src/hooks/useSessions.ts`

- [ ] **Step 1: 实现 hook**

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

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useSessions.ts
git commit -m "feat(app): useSessions hook — subscribe processes to buildSessions (E2)"
```

---

## Task 3: SessionPanel 组件

**Files:**
- Create: `app/src/components/SessionPanel.tsx`

- [ ] **Step 1: 实现组件**

新建 `app/src/components/SessionPanel.tsx`：

```tsx
import { useState } from 'react';
import { useSessions } from '../hooks/useSessions';
import { useSessionStore } from '../store/sessionStore';
import { useProcessPanelStore } from '../store/processPanelStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { useFocusStore } from '../store/focusStore';
import { aggregateSession } from '../lib/sessionAggregate';
import { formatBytes } from '../lib/format';
import { ipc } from '../lib/ipc';
import { ConfirmDialog } from './ConfirmDialog';

export function SessionPanel() {
  useSessions(); // 启动订阅（订阅 processPanelStore，无独立轮询）
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useFocusStore((s) => s.focusedSessionId);
  const focusSession = useFocusStore((s) => s.focusSession);
  const focus = useFocusStore((s) => s.focus);
  const processes = useProcessPanelStore((s) => s.processes);
  const cpuMap = useProcessPanelStore((s) => s.cpuMap);
  const connections = usePortRadarStore((s) => s.connections);

  const [pendingStop, setPendingStop] = useState<{ rootPid: number; label: string } | null>(null);
  const [killBusy, setKillBusy] = useState(false);

  async function doStop() {
    if (!pendingStop || killBusy) return;
    setKillBusy(true);
    try {
      const killed = await ipc.killTree(pendingStop.rootPid);
      setPendingStop(null);
      if (killed === 0) {
        alert('未结束任何进程：根进程可能受保护、权限不足或已退出');
      }
      // session 在下次 processScan 刷新后自然消失
    } catch (e) {
      setPendingStop(null);
      alert(`停止会话失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-base-700 px-4 py-3">
          <h1 className="text-lg font-semibold text-fg-primary">AI 会话</h1>
        </header>
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-fg-muted">
          未检测到 AI 开发会话。<br />Codex / Claude / Aider / Cursor / Ollama 等运行时会出现在此。
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-base-700 px-4 py-3">
        <h1 className="text-lg font-semibold text-fg-primary">AI 会话</h1>
        <p className="text-xs text-fg-muted">{sessions.length} 个活跃会话</p>
      </header>
      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-2">
          {sessions.map((s) => {
            const agg = aggregateSession(s.pids, processes, cpuMap, connections);
            const isFocused = focusedSessionId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => { focusSession(s.id); focus(s.rootPid, 'process'); }}
                className={`cursor-pointer rounded-lg border p-3 hover:bg-base-800 ${
                  isFocused ? 'border-cyan-400/70 ring-1 ring-cyan-400/40' : 'border-base-700 bg-base-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg-primary">{s.rootLabel}</span>
                    <span className="rounded bg-fuchsia-500/20 px-1 text-[10px] text-fuchsia-400">{s.kind}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingStop({ rootPid: s.rootPid, label: s.rootLabel }); }}
                    className="rounded bg-red-600/80 px-2 py-0.5 text-xs text-white hover:bg-red-500"
                  >
                    停止
                  </button>
                </div>
                <div className="mt-1.5 flex gap-4 text-xs text-fg-muted">
                  <span>{agg.processCount} 进程</span>
                  <span className="font-mono text-fg-secondary">CPU {agg.totalCpu.toFixed(1)}%</span>
                  <span className="font-mono text-fg-secondary">{formatBytes(agg.totalMemory)}</span>
                  {agg.listenPortCount > 0 && <span className="text-accent">{agg.listenPortCount} 端口</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={pendingStop !== null}
        title="停止 AI 会话"
        message={pendingStop ? `确定停止「${pendingStop.label}」及其所有子进程吗？` : ''}
        confirmLabel="停止会话"
        busy={killBusy}
        onConfirm={doStop}
        onCancel={() => { if (!killBusy) setPendingStop(null); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/components/SessionPanel.tsx
git commit -m "feat(app): SessionPanel — list/aggregate/focus/stop (E2)"
```

---

## Task 4: mosaic 注册（layoutStore + App.tsx）

**Files:**
- Modify: `app/src/store/layoutStore.ts`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: layoutStore 加 'sessions'**

`app/src/store/layoutStore.ts:16`：

```ts
export type BuiltInPanelId = 'port' | 'process' | 'perf' | 'snapshot';
```

改为：

```ts
export type BuiltInPanelId = 'port' | 'process' | 'perf' | 'snapshot' | 'sessions';
```

`:26-28` isBuiltInPanel：

```ts
export function isBuiltInPanel(id: string): id is BuiltInPanelId {
  return id === 'port' || id === 'process' || id === 'perf' || id === 'snapshot';
}
```

改为：

```ts
export function isBuiltInPanel(id: string): id is BuiltInPanelId {
  return id === 'port' || id === 'process' || id === 'perf' || id === 'snapshot' || id === 'sessions';
}
```

- [ ] **Step 2: App.tsx 注册**

`app/src/App.tsx`：

`BUILTIN_TITLES`（:26）加：
```ts
  sessions: 'AI 会话',
```

`ALL_BUILTIN`（:33）改为：
```ts
const ALL_BUILTIN: BuiltInPanelId[] = ['port', 'process', 'perf', 'snapshot', 'sessions'];
```

顶部 import 加：
```ts
import { SessionPanel } from './components/SessionPanel';
```

renderTile（:180 snapshot 分支后）加：
```tsx
                {id === 'sessions' && <SessionPanel />}
```

- [ ] **Step 3: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS（layoutStore 测试若断言 isBuiltIn 覆盖范围需同步，但现有测试不列举全部，应通过）。

- [ ] **Step 4: Commit**

```bash
git add app/src/store/layoutStore.ts app/src/App.tsx
git commit -m "feat(app): register 'sessions' panel in mosaic (E2)"
```

---

## Task 5: 全量验收

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（含新增 sessionAggregate 5）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native/IPC 改动**

Run: `git diff <e2-spec-commit>..HEAD --stat -- codemgr-native app/electron`
Expected: 空。

- [ ] **Step 4: 更新 AGENTS.md §8**

用实际测试数更新。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after E2 SessionPanel"
```

- [ ] **Step 6: 人工验收（记 PR）**

1. mosaic 添加 'AI 会话' 面板。
2. 启动一个 AI 工具（如 codex/claude）→ 面板出现该会话卡片。
3. 卡片显示进程数/CPU/内存/端口。
4. 点卡片 → 进程表定位到根进程 + 侧栏跟随。
5. 点"停止" → 确认 → 会话进程被 killTree 结束，下次刷新 session 消失。
6. 无 AI 工具运行 → 空态提示。
