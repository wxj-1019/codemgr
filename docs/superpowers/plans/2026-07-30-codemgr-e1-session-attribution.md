# CodeMgr E1 — Session 归属算法 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯函数从瞬时进程快照识别 AI 会话（种子 + ppid 后代收集），加 sessionStore 保存结果 + focusStore 扩展 focusedSessionId。

**Architecture:** `buildSessions(processes)` 建 ppid 反向邻接 → AI 种子（labelForProcess kind=ai/ai-ide）→ DFS 收集后代（visited 防环 + claimed 去重）。sessionStore 存结果 + focusedSessionId（消失自动清）。focusStore 加平行 focusedSessionId。纯函数 + store，无 UI/IPC/native。

**Tech Stack:** React 18 + TypeScript + Zustand + Vitest。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-e1-session-attribution.md`

**分支:** `feat/e1-session-attribution`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新建纯函数 | `app/src/lib/sessionAttribution.ts` | `buildSessions` + `Session` 类型 |
| 新建 store | `app/src/store/sessionStore.ts` | sessions + focusedSessionId |
| 改 store | `app/src/store/focusStore.ts` | 加 focusedSessionId + focusSession |
| 测试 | `app/tests/sessionAttribution.test.ts`（新建） | 纯函数 TDD |
| 测试 | `app/tests/sessionStore.test.ts`（新建） | store TDD |

---

## Task 1: buildSessions 纯函数（TDD）

**Files:**
- Create: `app/src/lib/sessionAttribution.ts`
- Test: `app/tests/sessionAttribution.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `app/tests/sessionAttribution.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildSessions } from '../src/lib/sessionAttribution';
import type { ProcessInfo } from '../electron/ipc-types';

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'x.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, ...over,
});

// 注入式种子判定：测试不依赖真实 labelForProcess，按 pid 显式标记种子
const seedOf = (seedPids: Set<number>) => (proc: ProcessInfo) => seedPids.has(proc.pid);

describe('buildSessions', () => {
  it('collects root + direct children into one session', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }),  // root (seed)
      p({ pid: 11, ppid: 10 }), // child
      p({ pid: 12, ppid: 10 }), // child
      p({ pid: 99, ppid: 1 }),  // unrelated
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rootPid).toBe(10);
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it('collects deep descendants (root→a→b→c)', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }),
      p({ pid: 11, ppid: 10 }),
      p({ pid: 12, ppid: 11 }),
      p({ pid: 13, ppid: 12 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });

  it('returns empty array when no seed', () => {
    const procs = [p({ pid: 10, ppid: 1 }), p({ pid: 11, ppid: 10 })];
    expect(buildSessions(procs, { isSeed: seedOf(new Set()) })).toEqual([]);
  });

  it('produces multiple sessions for independent roots', () => {
    const procs = [
      p({ pid: 10, ppid: 1 }), p({ pid: 11, ppid: 10 }),
      p({ pid: 20, ppid: 1 }), p({ pid: 21, ppid: 20 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10, 20])) });
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.rootPid).sort();
    expect(ids).toEqual([10, 20]);
  });

  it('first seed claims overlapping descendant (no duplicate)', () => {
    // x 是 rootA 的子，也是 rootB 的子（图里 x.ppid 同时满足？不可能，ppid 唯一）
    // 改为：x 是 rootA 的后代，rootB 也是 rootA 的后代但也是种子 → rootB 被 rootA 先认领
    const procs = [
      p({ pid: 10, ppid: 1 }),  // rootA seed
      p({ pid: 20, ppid: 10 }), // rootB seed（但也是 rootA 的子）
      p({ pid: 30, ppid: 20 }), // 孙
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10, 20])) });
    // rootA 先认领 20（作为后代），20 不再独立成 session
    expect(sessions).toHaveLength(1);
    expect(sessions[0].rootPid).toBe(10);
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('does not infinite-loop on ppid cycle (A.ppid=B, B.ppid=A)', () => {
    const procs = [
      p({ pid: 10, ppid: 20 }), // A
      p({ pid: 20, ppid: 10 }), // B
    ];
    // 给 A 设种子；DFS 应因 visited 不死循环
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('skips self-referencing ppid (p.ppid === p.pid)', () => {
    const procs = [
      p({ pid: 10, ppid: 10 }), // 自引用种子
      p({ pid: 11, ppid: 10 }),
    ];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions[0].pids.sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('session identity is rootPid:createTimeMs', () => {
    const procs = [p({ pid: 10, ppid: 1, createTimeMs: 12345 })];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions[0].id).toBe('10:12345');
  });

  it('seed with no descendants is still a valid session', () => {
    const procs = [p({ pid: 10, ppid: 1 })];
    const sessions = buildSessions(procs, { isSeed: seedOf(new Set([10])) });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pids).toEqual([10]);
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/sessionAttribution.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 sessionAttribution.ts**

新建 `app/src/lib/sessionAttribution.ts`：

```ts
import type { ProcessInfo } from '../../electron/ipc-types';
import { labelForProcess } from './processLabels';

export interface Session {
  /** Session 身份 = 根进程的 pid:createTimeMs（复用 snapshotIdentity 范式）。 */
  id: string;
  /** 根进程 pid（便于 E2 调 killTree）。 */
  rootPid: number;
  /** 根进程的 label kind（'ai' | 'ai-ide'，或注入种子的标记）。 */
  kind: string;
  /** 根进程显示名（如 'Codex CLI'）。 */
  rootLabel: string;
  /** 属于此 session 的所有 pid（含根）。 */
  pids: number[];
  /** 根进程创建时间（session 开始近似）。 */
  startedAt: number;
}

export interface BuildSessionsOptions {
  /** 种子判定函数，默认用 labelForProcess 判 ai/ai-ide。可注入便于测试。 */
  isSeed?: (p: ProcessInfo) => { kind: string; label: string } | null;
}

/**
 * 从瞬时进程快照识别 AI 会话（E1，单快照 MVP）。
 *
 * 算法：建 ppid 反向邻接 → 识别种子（默认 ai/ai-ide kind）→ 对每个种子
 * DFS 收集后代（visited 防环 + claimed 去重，首种子优先）。
 *
 * 局限（MVP 接受）：根进程退出后，后代因 ppid 断链变"根"，不再属于本 session。
 * 详见 spec §8。
 */
export function buildSessions(processes: ProcessInfo[], options?: BuildSessionsOptions): Session[] {
  const isSeed = options?.isSeed ?? defaultIsSeed;

  // ppid 反向邻接：pid → 其直接子进程
  const childrenOf = new Map<number, ProcessInfo[]>();
  for (const proc of processes) {
    const arr = childrenOf.get(proc.ppid) ?? [];
    arr.push(proc);
    childrenOf.set(proc.ppid, arr);
  }

  // 按原顺序识别种子（保证首种子优先认领）
  const seeds: Array<{ proc: ProcessInfo; kind: string; label: string }> = [];
  for (const proc of processes) {
    const m = isSeed(proc);
    if (m) seeds.push({ proc, kind: m.kind, label: m.label });
  }

  const claimed = new Set<number>();
  const sessions: Session[] = [];

  for (const { proc, kind, label } of seeds) {
    if (claimed.has(proc.pid)) continue; // 已被前一个 session 认领（种子互为后代场景）

    // DFS 收集后代
    const pids: number[] = [];
    const visited = new Set<number>();
    const stack = [proc.pid];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (claimed.has(cur) && cur !== proc.pid) continue; // 已被认领（根自身除外）
      claimed.add(cur);
      pids.push(cur);
      const children = childrenOf.get(cur) ?? [];
      for (const c of children) {
        if (c.pid === cur) continue; // 自引用 guard
        if (!visited.has(c.pid)) stack.push(c.pid);
      }
    }

    sessions.push({
      id: `${proc.pid}:${proc.createTimeMs}`,
      rootPid: proc.pid,
      kind,
      rootLabel: label,
      pids,
      startedAt: proc.createTimeMs,
    });
  }

  return sessions;
}

function defaultIsSeed(p: ProcessInfo): { kind: string; label: string } | null {
  const label = labelForProcess(p.name, p.cmdline);
  if (!label) return null;
  if (label.kind === 'ai' || label.kind === 'ai-ide') return { kind: label.kind, label: label.label };
  return null;
}
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/sessionAttribution.test.ts`
Expected: PASS —— 全部 9 用例通过。

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/sessionAttribution.ts app/tests/sessionAttribution.test.ts
git commit -m "feat(app): buildSessions pure function — AI session attribution (E1)

Identifies AI sessions from instantaneous process snapshot: AI seed
(labelForProcess kind=ai/ai-ide) → DFS descendant collection via ppid reverse
adjacency, with visited cycle-guard and claimed-set dedup (first seed wins).
Session identity = rootPid:createTimeMs. Single-snapshot MVP (accepts
root-exit breakage)."
```

---

## Task 2: sessionStore

**Files:**
- Create: `app/src/store/sessionStore.ts`
- Test: `app/tests/sessionStore.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `app/tests/sessionStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../src/store/sessionStore';
import type { Session } from '../src/lib/sessionAttribution';

const session = (over: Partial<Session> = {}): Session => ({
  id: '10:1000', rootPid: 10, kind: 'ai', rootLabel: 'Codex CLI',
  pids: [10, 11], startedAt: 1000, ...over,
});

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it('initial state empty', () => {
    expect(useSessionStore.getState().sessions).toEqual([]);
    expect(useSessionStore.getState().focusedSessionId).toBeNull();
  });

  it('setSessions stores sessions', () => {
    useSessionStore.getState().setSessions([session()]);
    expect(useSessionStore.getState().sessions).toHaveLength(1);
  });

  it('setSessions clears focusedSessionId when its session disappears', () => {
    useSessionStore.getState().setSessions([session({ id: '10:1000' })]);
    useSessionStore.getState().setFocusedSession('10:1000');
    expect(useSessionStore.getState().focusedSessionId).toBe('10:1000');
    // 下一次刷新该 session 消失
    useSessionStore.getState().setSessions([session({ id: '20:2000' })]);
    expect(useSessionStore.getState().focusedSessionId).toBeNull();
  });

  it('setSessions keeps focusedSessionId when its session persists', () => {
    useSessionStore.getState().setSessions([session({ id: '10:1000' })]);
    useSessionStore.getState().setFocusedSession('10:1000');
    useSessionStore.getState().setSessions([session({ id: '10:1000' }), session({ id: '20:2000' })]);
    expect(useSessionStore.getState().focusedSessionId).toBe('10:1000');
  });

  it('reset clears everything', () => {
    useSessionStore.getState().setSessions([session()]);
    useSessionStore.getState().setFocusedSession('10:1000');
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().sessions).toEqual([]);
    expect(useSessionStore.getState().focusedSessionId).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/sessionStore.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 sessionStore**

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
    focusedSessionId:
      prev.focusedSessionId && s.some((x) => x.id === prev.focusedSessionId)
        ? prev.focusedSessionId
        : null,
  })),
  setFocusedSession: (id) => set({ focusedSessionId: id }),
  reset: () => set({ sessions: [], focusedSessionId: null }),
}));
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/sessionStore.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/src/store/sessionStore.ts app/tests/sessionStore.test.ts
git commit -m "feat(app): sessionStore — sessions + focusedSessionId (E1)"
```

---

## Task 3: focusStore 扩展 focusedSessionId

**Files:**
- Modify: `app/src/store/focusStore.ts`
- Modify: `app/tests/focusStore.test.ts`

- [ ] **Step 1: 加 focusedSessionId + focusSession**

`app/src/store/focusStore.ts` 接口加：

```ts
  /** 全局聚焦的 session（E1）。与 focusedPid 独立。null=无。 */
  focusedSessionId: string | null;
  /** 设/清 session 聚焦。 */
  focusSession: (id: string | null) => void;
```

初始 state 加 `focusedSessionId: null,`。

新增 setter：

```ts
  focusSession: (id) => set({ focusedSessionId: id }),
```

- [ ] **Step 2: 加测试**

`app/tests/focusStore.test.ts` 末尾加：

```ts
  it('focusSession sets focusedSessionId independently of focusedPid', () => {
    useFocusStore.getState().focus(1234, 'port');
    useFocusStore.getState().focusSession('10:1000');
    expect(useFocusStore.getState().focusedPid).toBe(1234);
    expect(useFocusStore.getState().focusedSessionId).toBe('10:1000');
    useFocusStore.getState().focusSession(null);
    expect(useFocusStore.getState().focusedSessionId).toBeNull();
    expect(useFocusStore.getState().focusedPid).toBe(1234); // 不受影响
  });
```

并在 beforeEach 已有的 `focus(null)` 后加 `useFocusStore.getState().focusSession(null);`。

- [ ] **Step 3: typecheck + 测试**

Run: `cd app && pnpm typecheck && pnpm vitest run tests/focusStore.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add app/src/store/focusStore.ts app/tests/focusStore.test.ts
git commit -m "feat(app): focusStore adds focusedSessionId (E1)"
```

---

## Task 4: 全量验收

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（含新增 sessionAttribution 9 + sessionStore 5 + focusStore +1）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native/IPC 改动**

Run: `git diff <e1-spec-commit>..HEAD --stat -- codemgr-native app/electron`
Expected: 空。

- [ ] **Step 4: 更新 AGENTS.md §8**

用实际测试数更新。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after E1 session attribution"
```
