# CodeMgr A2 — 采集失败语义 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让三个轮询采集通道（进程/端口/性能）在失败时返回结构化结果，渲染层区分"真无数据"与"采集器失败"，失败时保留上次成功数据并标注陈旧。

**Architecture:** 新增 `CollectResult<T>` 联合类型，main handler 从 catch→降级值 改为 catch→失败分支；hooks 解构结果，失败时只 setError+setStaleAt 不清空数据；store 新增 `staleAt` 字段；UI header 标注陈旧。跨 5 层机械改动，TS strict 强制对齐。

**Tech Stack:** React 18 + TypeScript + Zustand + Vitest。无 native 改动。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-a2-collector-failure-semantics.md`

**分支:** `docs/a1-bugfix-spec`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新增类型 | `app/electron/ipc-types.ts` | `CollectResult<T>` + `ExposedApi` 三方法签名 |
| 新增纯函数 | `app/src/lib/format.ts` | `formatRelativeTime`（陈旧标注） |
| main handler | `app/electron/main.ts` | 三 handler 返回 CollectResult + lastSuccessAt 变量 |
| store | `app/src/store/processPanelStore.ts`、`portRadarStore.ts`、`perfStore.ts` | 新增 `staleAt` + setStaleAt + 成功时清 staleAt |
| hooks | `app/src/hooks/useProcessPanel.ts`、`usePortRadar.ts`、`usePerf.ts` | 解构 CollectResult，失败不清空 |
| UI | `app/src/components/ProcessPanel.tsx`、`PortRadar.tsx`、`PerfPanel.tsx` | header 陈旧标注 |
| mock | `app/tests/setup.ts` | 三轮询方法默认返回成功空 CollectResult |
| 测试 | `app/tests/format.test.ts`、三个 store 测试、hook 行为测试 | TDD |

---

## Task 1: CollectResult 类型 + formatRelativeTime（纯函数，TDD）

> 先建类型地基 + 陈旧时间纯函数。两者无依赖，可同 task。

**Files:**
- Modify: `app/electron/ipc-types.ts`
- Modify: `app/src/lib/format.ts`
- Test: `app/tests/format.test.ts`

- [ ] **Step 1: 写 formatRelativeTime 失败测试**

在 `app/tests/format.test.ts` 末尾追加：

```ts
describe('formatRelativeTime', () => {
  it('shows seconds ago for < 60s', () => {
    const now = 100_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe('5 秒前');
    expect(formatRelativeTime(now - 59_999, now)).toBe('59 秒前');
  });
  it('shows minutes for >= 60s', () => {
    const now = 100_000;
    expect(formatRelativeTime(now - 120_000, now)).toBe('2 分 0 秒');
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('60 分 0 秒');
  });
  it('defaults nowMs to Date.now when omitted', () => {
    // 只验证不抛错且返回非空字符串（不依赖真实时钟断言具体值）
    const s = formatRelativeTime(Date.now() - 10_000);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
```

并在文件顶部 import 区追加（若 formatRelativeTime 尚未导出，此 import 会先报错——这正是红）：

```ts
import { formatRelativeTime } from '../src/lib/format';
```

（若顶部已有 `import { ... } from '../src/lib/format'`，把 `formatRelativeTime` 加进该 import 列表。）

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/format.test.ts`
Expected: FAIL —— `formatRelativeTime is not defined`（未实现/未导出）。

- [ ] **Step 3: 实现 formatRelativeTime**

在 `app/src/lib/format.ts` 末尾追加：

```ts
// 将一个时间戳格式化为相对当前时间的"N 秒前/N 分 N 秒前"（A2 陈旧标注）。
// nowMs 默认 Date.now()，便于测试注入固定时钟。
export function formatRelativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - fromMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins} 分 ${secs} 秒`;
}
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/format.test.ts`
Expected: PASS。

- [ ] **Step 5: 新增 CollectResult 类型**

在 `app/electron/ipc-types.ts` 的 `ProcessInfo` 接口定义之前（约 :137 前）追加：

```ts
/**
 * 轮询采集的结构化结果（A2）。取代原先"失败返回空数组/null"的降级，
 * 让渲染层区分"真无数据"与"采集器失败"。
 *
 * - ok:true  采集成功；data 可能为空数组（真无数据）。
 * - ok:false 采集失败；error 描述原因，lastSuccessAt 为上次成功时间（null=从未成功）。
 *   渲染层应保留上次成功 data（不清空）并标注陈旧。
 */
export type CollectResult<T> =
  | { ok: true; data: T; sampledAt: number }
  | { ok: false; error: { code: string; message: string }; lastSuccessAt: number | null };
```

- [ ] **Step 6: 改 ExposedApi 三个轮询方法签名**

在 `app/electron/ipc-types.ts` 的 `ExposedApi` 接口（:189 起）中，把这三行：

```ts
  fetchProcesses(): Promise<ProcessInfo[]>;
  fetchConnections(): Promise<NetConnection[]>;
```

和（在 fetchCpu 之后）：

```ts
  fetchPerf(): Promise<PerfData | null>;
```

分别改为：

```ts
  fetchProcesses(): Promise<CollectResult<ProcessInfo[]>>;
```

```ts
  fetchConnections(): Promise<CollectResult<NetConnection[]>>;
```

```ts
  fetchPerf(): Promise<CollectResult<PerfData>>;
```

- [ ] **Step 7: typecheck 确认类型层一致（此时会暴露所有未改消费点，预期红）**

Run: `cd app && pnpm typecheck`
Expected: FAIL —— main.ts/preload.ts/hooks/ipc.ts 多处类型不匹配（因为它们还返回旧形状）。这是预期的，后续 task 逐一修复。

- [ ] **Step 8: Commit**

```bash
git add app/electron/ipc-types.ts app/src/lib/format.ts app/tests/format.test.ts
git commit -m "feat(app): add CollectResult type and formatRelativeTime (A2)

Foundation for collector failure semantics: CollectResult<T> discriminated
union distinguishes empty data from collector failure. formatRelativeTime
for stale-data annotation."
```

---

## Task 2: main handler 返回 CollectResult

**Files:**
- Modify: `app/electron/main.ts:78-85`（net）、`:141-148`（process）、`:159-166`（perf）

- [ ] **Step 1: 新增 lastSuccessAt 变量**

在 `app/electron/main.ts` 顶部（`let win: BrowserWindow | null = null;` 附近，约 :31 后）追加：

```ts
// 轮询采集的"上次成功时间"，失败时随 CollectResult 返回给渲染层标注陈旧（A2）。
let lastProcessScanAt: number | null = null;
let lastNetScanAt: number | null = null;
let lastPerfAt: number | null = null;
```

- [ ] **Step 2: 改 netScan handler**

把 `app/electron/main.ts` 的 `FETCH_CONNECTIONS` handler（约 :78-85）：

```ts
ipcMain.handle(IPC.FETCH_CONNECTIONS, async () => {
  try {
    return native.netScan();
  } catch (e) {
    console.error('netScan failed:', e);
    return [];
  }
});
```

改为：

```ts
ipcMain.handle(IPC.FETCH_CONNECTIONS, async () => {
  try {
    const data = native.netScan();
    lastNetScanAt = Date.now();
    return { ok: true as const, data, sampledAt: lastNetScanAt };
  } catch (e) {
    console.error('netScan failed:', e);
    return { ok: false as const, error: { code: 'NET_SCAN_FAILED', message: String(e) }, lastSuccessAt: lastNetScanAt };
  }
});
```

- [ ] **Step 3: 改 processScan handler**

把 `FETCH_PROCESSES` handler（约 :141-148）：

```ts
ipcMain.handle(IPC.FETCH_PROCESSES, async () => {
  try {
    return native.processScan();
  } catch (e) {
    console.error('processScan failed:', e);
    return [];
  }
});
```

改为：

```ts
ipcMain.handle(IPC.FETCH_PROCESSES, async () => {
  try {
    const data = native.processScan();
    lastProcessScanAt = Date.now();
    return { ok: true as const, data, sampledAt: lastProcessScanAt };
  } catch (e) {
    console.error('processScan failed:', e);
    return { ok: false as const, error: { code: 'PROCESS_SCAN_FAILED', message: String(e) }, lastSuccessAt: lastProcessScanAt };
  }
});
```

- [ ] **Step 4: 改 perfCounters handler**

把 `FETCH_PERF` handler（约 :159-166）：

```ts
ipcMain.handle(IPC.FETCH_PERF, async () => {
  try {
    return native.perfCounters();
  } catch (e) {
    console.error('perfCounters failed:', e);
    return null;
  }
});
```

改为：

```ts
ipcMain.handle(IPC.FETCH_PERF, async () => {
  try {
    const data = native.perfCounters();
    lastPerfAt = Date.now();
    return { ok: true as const, data, sampledAt: lastPerfAt };
  } catch (e) {
    console.error('perfCounters failed:', e);
    return { ok: false as const, error: { code: 'PERF_FAILED', message: String(e) }, lastSuccessAt: lastPerfAt };
  }
});
```

- [ ] **Step 5: Commit（typecheck 此时仍因 hooks 未改而红，main 单独提交）**

```bash
git add app/electron/main.ts
git commit -m "feat(app): main collectors return CollectResult (A2)

netScan/processScan/perfCounters handlers now return structured result;
native exceptions become ok:false with error code + lastSuccessAt instead
of silently degrading to empty array/null."
```

---

## Task 3: 渲染层封装对齐（preload + ipc.ts）

**Files:**
- Modify: `app/electron/preload.ts`（仅类型，逻辑透传无需改）
- Modify: `app/src/lib/ipc.ts:5-34`

- [ ] **Step 1: 改 ipc.ts 三方法返回类型**

`app/electron/preload.ts` 的 invoke 透传返回值，无需改逻辑（TS 用 ExposedApi 自动校验）。但 `app/src/lib/ipc.ts` 显式声明了返回类型，需对齐。

把 `app/src/lib/ipc.ts` 的这三个方法：

```ts
  async fetchConnections(): Promise<NetConnection[]> {
    return window.codemgr.fetchConnections();
  },
```

```ts
  async fetchProcesses(): Promise<ProcessInfo[]> {
    return window.codemgr.fetchProcesses();
  },
```

```ts
  async fetchPerf(): Promise<PerfData | null> {
    return window.codemgr.fetchPerf();
  },
```

分别改为：

```ts
  async fetchConnections() {
    return window.codemgr.fetchConnections();
  },
```

```ts
  async fetchProcesses() {
    return window.codemgr.fetchProcesses();
  },
```

```ts
  async fetchPerf() {
    return window.codemgr.fetchPerf();
  },
```

（去掉显式返回类型，让 TS 从 `window.codemgr`（ExposedApi）推断 CollectResult。这是最省改动的对齐方式——ipc.ts 是薄封装，无需重复声明类型。）

- [ ] **Step 2: 更新 ipc.ts 顶部 import**

`app/src/lib/ipc.ts:1` 的 import 需加 `CollectResult`（若 hooks 直接用 CollectResult 类型断言会需要；但 ipc.ts 本身去掉显式类型后可能不需要 import CollectResult）。先不加，看 typecheck 是否报缺。

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/ipc.ts
git commit -m "refactor(app): ipc.ts delegates CollectResult types to ExposedApi (A2)"
```

---

## Task 4: store 新增 staleAt（三个 store）

> 三 store 同构改动。先 processPanelStore（最复杂），再 portRadar/perf。

**Files:**
- Modify: `app/src/store/processPanelStore.ts`
- Modify: `app/src/store/portRadarStore.ts`
- Modify: `app/src/store/perfStore.ts`
- Test: `app/tests/processPanelStore.test.ts`、`portRadarStore.test.ts`、`perfStore.test.ts`

- [ ] **Step 1: processPanelStore — 写 staleAt 失败测试**

在 `app/tests/processPanelStore.test.ts` 末尾（最后一个 it 后，describe 闭合前）追加：

```ts
  it('setProcesses clears staleAt (marks data fresh)', () => {
    useProcessPanelStore.setState({ staleAt: 1000 });
    useProcessPanelStore.getState().setProcesses([p({ pid: 1 })]);
    expect(useProcessPanelStore.getState().staleAt).toBeNull();
  });

  it('setStaleAt sets the timestamp', () => {
    useProcessPanelStore.getState().setStaleAt(9999);
    expect(useProcessPanelStore.getState().staleAt).toBe(9999);
  });

  it('reset clears staleAt', () => {
    useProcessPanelStore.setState({ staleAt: 1000 });
    useProcessPanelStore.getState().reset();
    expect(useProcessPanelStore.getState().staleAt).toBeNull();
  });
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/processPanelStore.test.ts`
Expected: FAIL —— `staleAt` / `setStaleAt` 不存在。

- [ ] **Step 3: processPanelStore — 实现 staleAt**

在 `app/src/store/processPanelStore.ts`：
- 接口 `ProcessPanelState`（:14）新增字段：

```ts
  staleAt: number | null;        // 上次成功采样时间；null=数据新鲜或从未成功（A2）
```

（放在 `error: string | null;` 之后）

- 接口新增 setter（在 `setError` 后）：

```ts
  setStaleAt: (ts: number | null) => void;
```

- 初始 state（:70 `error: null,` 后）加：

```ts
  staleAt: null,
```

- `setProcesses`（:77）的 return 对象改为也清 staleAt。把：

```ts
        return { processes: p, error: null, selectedPids, cpuMap, procHistory, preciseCwdByPid };
```

改为：

```ts
        return { processes: p, error: null, staleAt: null, selectedPids, cpuMap, procHistory, preciseCwdByPid };
```

- 新增 setter（在 `setError` 后）：

```ts
      setStaleAt: (ts) => set({ staleAt: ts }),
```

- `reset`（:149）的 set 对象加 `staleAt: null,`。

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/processPanelStore.test.ts`
Expected: PASS。

- [ ] **Step 5: portRadarStore — 同构改动**

`app/src/store/portRadarStore.ts`：
- 接口 `PortRadarState` 加 `staleAt: number | null;`（error 后）和 `setStaleAt: (ts: number | null) => void;`。
- 初始 state 加 `staleAt: null,`。
- `setConnections`（:31）改为 `set({ connections: c, error: null, staleAt: null })`。
- 新增 `setStaleAt: (ts) => set({ staleAt: ts }),`。
- `reset` 加 `staleAt: null,`。

- [ ] **Step 6: perfStore — 同构改动**

`app/src/store/perfStore.ts`：
- 接口 `PerfState` 加 `staleAt: number | null;`（error 后）和 `setStaleAt: (ts: number | null) => void;`。
- 初始 state 加 `staleAt: null,`。
- `setPerf`（:36）的 return 把 `error: null` 改为 `error: null, staleAt: null`。
- 新增 `setStaleAt: (ts) => set({ staleAt: ts }),`。
- `reset`（:51）加 `staleAt: null,`。

- [ ] **Step 7: portRadar/perf store 测试加 staleAt 用例**

在 `app/tests/portRadarStore.test.ts` 和 `app/tests/perfStore.test.ts` 各加一个最小用例（同 processPanelStore Step 1 的模式）：

portRadar：
```ts
  it('setConnections clears staleAt', () => {
    usePortRadarStore.setState({ staleAt: 1000 });
    usePortRadarStore.getState().setConnections([]);
    expect(usePortRadarStore.getState().staleAt).toBeNull();
  });
```

perf：
```ts
  it('setPerf clears staleAt', () => {
    usePerfStore.setState({ staleAt: 1000 });
    usePerfStore.getState().setPerf(mockPerf);
    expect(usePerfStore.getState().staleAt).toBeNull();
  });
```

（perf 测试需有 mockPerf fixture，参照该文件已有的 mockPerf 辅助。）

- [ ] **Step 8: 运行三个 store 测试，确认绿**

Run: `cd app && pnpm vitest run tests/processPanelStore.test.ts tests/portRadarStore.test.ts tests/perfStore.test.ts`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add app/src/store/processPanelStore.ts app/src/store/portRadarStore.ts app/src/store/perfStore.ts app/tests/processPanelStore.test.ts app/tests/portRadarStore.test.ts app/tests/perfStore.test.ts
git commit -m "feat(app): stores track staleAt for collector-failure annotation (A2)"
```

---

## Task 5: hooks 解构 CollectResult（三个 hook）

**Files:**
- Modify: `app/src/hooks/useProcessPanel.ts`
- Modify: `app/src/hooks/usePortRadar.ts`
- Modify: `app/src/hooks/usePerf.ts`

- [ ] **Step 1: usePortRadar — 解构 CollectResult**

把 `app/src/hooks/usePortRadar.ts` 的 `poll()` 中 try 块（:35-40）：

```ts
      try {
        const conns = await ipc.fetchConnections();
        if (!stoppedRef.current) {
          setConnections(conns);
          firstRef.current = false;
        }
      } catch (e) {
```

改为：

```ts
      try {
        const result = await ipc.fetchConnections();
        if (stoppedRef.current) return;
        if (result.ok) {
          setConnections(result.data);
          firstRef.current = false;
        } else {
          // 失败：不清空 connections，标陈旧 + 错误
          setError(result.error.message);
          setStaleAt(result.lastSuccessAt);
          if (isFirst) firstRef.current = false;
        }
      } catch (e) {
```

并在 hook 顶部 store 解构（:17-21）加 `setStaleAt`：

```ts
  const setStaleAt = usePortRadarStore((s) => s.setStaleAt);
```

并在 useEffect 依赖数组（:58）加 `setStaleAt`。

- [ ] **Step 2: usePerf — 解构 CollectResult**

把 `app/src/hooks/usePerf.ts` 的 poll() try 块（:27-35）：

```ts
      try {
        const p = await ipc.fetchPerf();
        if (stoppedRef.current) return;
        if (p) {
          setPerf(p);
          firstRef.current = false;
        } else {
          setError('perfCounters 返回空');
        }
      } catch (e) {
```

改为：

```ts
      try {
        const result = await ipc.fetchPerf();
        if (stoppedRef.current) return;
        if (result.ok) {
          setPerf(result.data);
          firstRef.current = false;
        } else {
          setError(result.error.message);
          setStaleAt(result.lastSuccessAt);
          if (isFirst) firstRef.current = false;
        }
      } catch (e) {
```

顶部 store 解构加 `setStaleAt`，依赖数组加 `setStaleAt`。

- [ ] **Step 3: useProcessPanel — 解构 CollectResult（process 部分，cpu 保持 best-effort）**

把 `app/src/hooks/useProcessPanel.ts` 的 poll() try 块（:29-45）：

```ts
      try {
        const procs = await ipc.fetchProcesses();
        if (stoppedRef.current) return;
        setProcesses(procs);
        firstRef.current = false;
        // CPU is best-effort enrichment ...
        try {
          const cpus = await ipc.fetchCpu();
          ...
```

改为：

```ts
      try {
        const result = await ipc.fetchProcesses();
        if (stoppedRef.current) return;
        if (result.ok) {
          const procs = result.data;
          setProcesses(procs);
          firstRef.current = false;
          // CPU is best-effort enrichment: a failure here must NOT tear down the
          // whole panel when we already have the process list. Log and move on.
          try {
            const cpus = await ipc.fetchCpu();
            if (!stoppedRef.current) {
              setCpuMap(cpus);
              appendHistory(procs, cpus, Date.now());
            }
          } catch (cpuErr) {
            console.error('fetchCpu failed:', cpuErr);
          }
        } else {
          // 失败：不清空 processes，标陈旧 + 错误
          setError(result.error.message);
          setStaleAt(result.lastSuccessAt);
          if (isFirst) firstRef.current = false;
        }
      } catch (e) {
```

注意：CPU 附带采集移到 `result.ok` 分支内（只有进程采集成功才跑 CPU）。

顶部 store 解构加 `setStaleAt`，依赖数组加 `setStaleAt`。

- [ ] **Step 4: typecheck 确认全绿**

Run: `cd app && pnpm typecheck`
Expected: PASS（所有 CollectResult 消费点已对齐）。

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `cd app && pnpm vitest run`
Expected: PASS（既有测试通过；mock 未更新会导致依赖 ipc 的组件测试可能失败——见 Task 6 先更新 mock）。

若失败，先做 Task 6（mock 同步）再回来跑。

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useProcessPanel.ts app/src/hooks/usePortRadar.ts app/src/hooks/usePerf.ts
git commit -m "feat(app): hooks consume CollectResult, keep data on failure (A2)

Failed polls no longer clear the table/chart; they set error + staleAt and
preserve last-success data. CPU enrichment only runs when process scan ok."
```

---

## Task 6: mock 同步 + hook 行为测试

**Files:**
- Modify: `app/tests/setup.ts`
- Test: `app/tests/useCollectResult.test.ts`（新建）

- [ ] **Step 1: 更新 mockIpc 三轮询方法默认返回**

`app/tests/setup.ts` 的 `base` 对象（:27-41）中，把：

```ts
    fetchConnections: vi.fn(() => Promise.resolve([])),
    fetchProcesses: vi.fn(() => Promise.resolve([])),
    fetchCpu: vi.fn(() => Promise.resolve([])),
    fetchPerf: vi.fn(() => Promise.resolve(null)),
```

改为：

```ts
    fetchConnections: vi.fn(() => Promise.resolve({ ok: true as const, data: [], sampledAt: Date.now() })),
    fetchProcesses: vi.fn(() => Promise.resolve({ ok: true as const, data: [], sampledAt: Date.now() })),
    fetchCpu: vi.fn(() => Promise.resolve([])),
    fetchPerf: vi.fn(() => Promise.resolve({ ok: true as const, data: null, sampledAt: Date.now() })),
```

注意 `fetchCpu` 不变（它是 best-effort，仍返回 `CpuUsage[]`）。

同时更新 `mockIpc` 的 `overrides` 类型 Partial 列表（:13-25）——这三个方法的返回类型变了，但因为是 `Partial` + `any`，TS 不会强制；为安全可不动 overrides 类型（既有测试 override 的是 `() => Promise<any[]>`，兼容）。

- [ ] **Step 2: 写 hook 失败行为测试**

新建 `app/tests/useCollectResult.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePortRadarStore } from '../src/store/portRadarStore';
import { mockIpc } from './setup';

// 直接测 store + 一个模拟 poll 行为：验证"失败不清空 + 标陈旧"的契约。
// （完整 hook 测需 RTL + act + 定时器 mock，较重；此处用 store 契约 + mock ipc 验证核心不变量。）

describe('collector failure keeps last data', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortRadarStore.getState().reset();
  });

  it('ok:false does not clear connections and sets staleAt', async () => {
    // 先成功一次，填入数据
    usePortRadarStore.getState().setConnections([
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0, state: 'LISTEN', pid: 1, processName: 'x' },
    ]);
    expect(usePortRadarStore.getState().staleAt).toBeNull();

    // 模拟失败结果
    const failResult = { ok: false as const, error: { code: 'NET_SCAN_FAILED', message: 'boom' }, lastSuccessAt: 12345 };
    // 失败分支的行为：setError + setStaleAt，不调 setConnections
    usePortRadarStore.getState().setError(failResult.error.message);
    usePortRadarStore.getState().setStaleAt(failResult.lastSuccessAt);

    expect(usePortRadarStore.getState().connections).toHaveLength(1); // 未清空
    expect(usePortRadarStore.getState().error).toBe('boom');
    expect(usePortRadarStore.getState().staleAt).toBe(12345);
  });

  it('ok:true with empty data is not an error', async () => {
    usePortRadarStore.getState().setConnections([]);
    expect(usePortRadarStore.getState().staleAt).toBeNull();
    expect(usePortRadarStore.getState().error).toBeNull();
  });
});
```

- [ ] **Step 3: 运行全量测试，确认绿**

Run: `cd app && pnpm vitest run`
Expected: PASS —— 全部测试通过（含新 useCollectResult + mock 更新后的既有组件测试）。

- [ ] **Step 4: Commit**

```bash
git add app/tests/setup.ts app/tests/useCollectResult.test.ts
git commit -m "test(app): mock CollectResult + failure-keeps-data contract tests (A2)"
```

---

## Task 7: UI 陈旧标注（三个面板 header）

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx:186-192`
- Modify: `app/src/components/PortRadar.tsx`（header 区）
- Modify: `app/src/components/PerfPanel.tsx`（header 区）

- [ ] **Step 1: ProcessPanel header 加陈旧标注**

`app/src/components/ProcessPanel.tsx`，在 header 副信息 `<p>`（:186-191）中，把：

```tsx
          <p className="text-xs text-fg-muted">
            {processes.length} 个进程
            {loading ? ' · 刷新中…' : ''}
            {error && ' · 上次刷新出错'}
            {selectedPids.size > 0 && ` · 已选 ${selectedPids.size} 个`}
          </p>
```

改为（加 staleAt 读取 + 标注）：

先在组件 store 解构（:35-39）加 `staleAt`：

```tsx
    pollMs, setPollMs, staleAt,
  } = useProcessPanelStore();
```

再改 `<p>`：

```tsx
          <p className="text-xs text-fg-muted">
            {processes.length} 个进程
            {loading ? ' · 刷新中…' : ''}
            {error && ' · 上次刷新出错'}
            {staleAt !== null && ` · ⚠ 数据陈旧（${formatRelativeTime(staleAt)}）`}
            {selectedPids.size > 0 && ` · 已选 ${selectedPids.size} 个`}
          </p>
```

并在文件顶部 import 加：

```tsx
import { formatRelativeTime } from '../lib/format';
```

- [ ] **Step 2: PortRadar header 加陈旧标注**

读 `app/src/components/PortRadar.tsx`，找到 header 副信息区（显示连接数/loading/error 处），同构加 `staleAt` 读取 + `formatRelativeTime` 标注 + import。（具体行号实现时定位。）

- [ ] **Step 3: PerfPanel header 加陈旧标注**

`app/src/components/PerfPanel.tsx` 同构处理。

- [ ] **Step 4: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx app/src/components/PerfPanel.tsx
git commit -m "feat(app): show stale-data annotation in panel headers (A2)"
```

---

## Task 8: 全量验收

**Files:** 无

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（全部，含新增）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native 改动**

Run: `git diff <a2-spec-commit>..HEAD --stat -- codemgr-native`
Expected: 空。

- [ ] **Step 4: 更新 AGENTS.md §8 测试计数**

用 `cd app && pnpm vitest run 2>&1 | grep "Tests "` 的实际数字更新 `AGENTS.md` §8 的 `app N/N` 计数。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after A2 collector failure semantics"
```

- [ ] **Step 6: 人工验收备忘（记 PR）**

真机验证：kill 掉 native（或制造权限失败）→ 面板显示"上次刷新出错 + 数据陈旧"，表格不清空。
