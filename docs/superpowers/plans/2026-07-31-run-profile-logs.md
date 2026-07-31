# RunProfile 日志闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RunManager 捕获 stdout/stderr 进 ring buffer（2000 行/run，退出后保留），新增 `run:getLogs` 增量通道，RunProfilesPanel 行内展开日志视图（2s 增量轮询 + 跟随滚动 + 本地清空）。

**Architecture:** main 侧纯函数 log buffer（`runProfiles.ts` 内 `createLogBuffer/appendLogChunk/flushLog/readLog`，TDD）+ RunManager 挂接 stdio data 事件 + 渲染层 `lib/runLogs.ts` 去重合并（TDD）+ `RunLogView` 组件（照 §10.2 轮询范式）。

**Tech Stack:** Node execFile stdio、zustand 无关（组件本地 state）、Vitest。

**Spec:** `docs/superpowers/specs/2026-07-31-run-profile-logs-design.md`

---

### Task 1: log buffer 纯函数 + 类型（TDD）

**Files:**
- Modify: `app/electron/ipc-types.ts`（加 RunLogLine/RunLogChunk 类型）
- Modify: `app/electron/runProfiles.ts`（加 buffer 纯函数）
- Test: `app/tests/runProfiles.test.ts`（扩展现有文件）

- [ ] **Step 1: ipc-types 加类型**（`RunState` 之后）

```ts
/** Run 日志行（子项目 C）。seq 由 main 按到达顺序单调分配（1 起）。 */
export interface RunLogLine {
  seq: number;
  text: string;
}

/**
 * 日志增量块（run:getLogs 返回）。nextSeq = 当前已分配的最大 seq（无行为 0），
 * 下次请求传 sinceSeq=nextSeq 即得增量。ring buffer 满 2000 行丢最老并累计 droppedBefore。
 */
export interface RunLogChunk {
  lines: RunLogLine[];
  droppedBefore: number;
  nextSeq: number;
}
```

- [ ] **Step 2: 写失败测试**（追加到 `app/tests/runProfiles.test.ts` 尾部新 describe）

```ts
describe('log buffer（子项目 C）', () => {
  it('appendLogChunk 按行切分并剥离 ANSI', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'ready in 300ms\n\x1b[32m✓\x1b[39m compiled\n');
    expect(buf.lines.map((l) => l.text)).toEqual(['ready in 300ms', '✓ compiled']);
    expect(buf.lines.map((l) => l.seq)).toEqual([1, 2]);
  });

  it('半截行进 pending，下一块拼合；\\r\\n 不产生空行', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'listen');
    expect(buf.lines).toHaveLength(0);
    appendLogChunk(buf, 'ing on :3000\r\nok\n');
    expect(buf.lines.map((l) => l.text)).toEqual(['listening on :3000', 'ok']);
  });

  it('flushLog 把退出时未换行的尾部落成最后一行', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'a\ntail-without-newline');
    flushLog(buf);
    expect(buf.lines.map((l) => l.text)).toEqual(['a', 'tail-without-newline']);
  });

  it('超 2000 行丢最老并累计 droppedBefore', () => {
    const buf = createLogBuffer();
    for (let i = 1; i <= 2001; i++) appendLogChunk(buf, `line${i}\n`);
    expect(buf.lines).toHaveLength(2000);
    expect(buf.droppedBefore).toBe(1);
    expect(buf.lines[0]!.text).toBe('line2');
  });

  it('readLog 增量：只返 seq>sinceSeq，nextSeq=已分配最大 seq', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'a\nb\nc\n');
    const all = readLog(buf, 0);
    expect(all.lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(all.nextSeq).toBe(3);
    const inc = readLog(buf, all.nextSeq);
    expect(inc.lines).toHaveLength(0);
    appendLogChunk(buf, 'd\n');
    expect(readLog(buf, all.nextSeq).lines.map((l) => l.text)).toEqual(['d']);
  });
});
```

import 区追加：`createLogBuffer, appendLogChunk, flushLog, readLog`（与既有 runProfiles import 同源）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd app && pnpm vitest run tests/runProfiles.test.ts`
Expected: FAIL（导出不存在）

- [ ] **Step 4: 实现**（追加到 `app/electron/runProfiles.ts` RunManager 之前）

```ts
// ── Run 日志 ring buffer（子项目 C，纯函数可 TDD）──
// 每 run 一个 buffer：stdout/stderr 合流按到达顺序入队，2000 行上限丢最老。
import type { RunLogLine, RunLogChunk } from './ipc-types';

export const MAX_LOG_LINES = 2000;

export interface LogBuffer {
  lines: RunLogLine[];
  nextSeq: number;      // 下一个待分配 seq（已分配最大 = nextSeq-1）
  droppedBefore: number;
  pending: string;      // 未换行的半截行，下一块拼合或退出时 flush
}

/** 剥离 ANSI 转义（CSI + OSC），日志纯文本显示（v1 不渲染颜色）。 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '');
}

export function createLogBuffer(): LogBuffer {
  return { lines: [], nextSeq: 1, droppedBefore: 0, pending: '' };
}

function pushLine(buf: LogBuffer, text: string): void {
  buf.lines.push({ seq: buf.nextSeq++, text });
  if (buf.lines.length > MAX_LOG_LINES) { buf.lines.shift(); buf.droppedBefore++; }
}

export function appendLogChunk(buf: LogBuffer, chunk: string): void {
  // \r\n 作为一个分隔处理；单独 \r（进度条覆盖写）也当换行，降级为多行纯文本
  const parts = (buf.pending + chunk).split(/\r\n|\n|\r/);
  buf.pending = parts.pop() ?? '';
  for (const raw of parts) {
    const text = stripAnsi(raw);
    if (raw !== '' && text === '') continue; // 纯控制序列行丢弃
    pushLine(buf, text);
  }
}

/** 进程退出时调用：未换行的尾部落为最后一行。 */
export function flushLog(buf: LogBuffer): void {
  const text = stripAnsi(buf.pending);
  buf.pending = '';
  if (text !== '') pushLine(buf, text);
}

/** 增量读取：只返 seq > sinceSeq 的行；nextSeq = 已分配最大 seq（空 buffer 为 0）。 */
export function readLog(buf: LogBuffer, sinceSeq: number): RunLogChunk {
  return {
    lines: buf.lines.filter((l) => l.seq > sinceSeq),
    droppedBefore: buf.droppedBefore,
    nextSeq: buf.nextSeq - 1,
  };
}
```

（`import type { RunProfile, RunState } from './ipc-types'` 行并入 `RunLogLine, RunLogChunk`；顶部新 import 不重复。）

- [ ] **Step 5: 跑测试确认通过 + Commit**

Run: `cd app && pnpm vitest run tests/runProfiles.test.ts`
Expected: PASS

```bash
git add app/electron/ipc-types.ts app/electron/runProfiles.ts app/tests/runProfiles.test.ts
git commit -m "feat(app): run log ring buffer (ansi-strip, 2000-line cap, incremental read)"
```

---

### Task 2: RunManager 捕获挂接 + getLogs（集成测试）

**Files:**
- Modify: `app/electron/runProfiles.ts`（RunManager）
- Test: `app/tests/runProfiles.test.ts`

- [ ] **Step 1: 写失败集成测试**（真实 spawn node，无 electron 依赖）

```ts
describe('RunManager 日志捕获（集成）', () => {
  it('捕获 stdout/stderr，退出后仍可读；未知 runId 返回 null', async () => {
    const mgr = new RunManager({ killTree: () => 0 }, () => {});
    const profile = validateProfile({
      id: '11111111-1111-1111-1111-111111111111',
      name: 't', command: 'node',
      args: ['-e', 'console.log("out-line"); console.error("err-line")'],
      cwd: process.cwd(),
    })!;
    const started = mgr.start(profile);
    expect(started).not.toBeNull();
    // 等进程退出（exit 事件驱动，最多 5s）
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 5000);
      const poll = setInterval(() => {
        if (mgr.getState(started!.runId)?.status === 'exited') {
          clearInterval(poll); clearTimeout(t); resolve();
        }
      }, 20);
    });
    const chunk = mgr.getLogs(started!.runId, 0);
    expect(chunk).not.toBeNull();
    expect(chunk!.lines.map((l) => l.text)).toEqual(['out-line', 'err-line']);
    expect(mgr.getLogs('no-such-run', 0)).toBeNull();
  }, 10000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Expected: FAIL（getLogs 不存在 / lines 为空）

- [ ] **Step 3: RunManager 改造**

```ts
export class RunManager {
  private runs = new Map<string, { child: ExecChild; state: RunState }>();
  private logs = new Map<string, LogBuffer>();
  // ...constructor 不变

  start(profile: RunProfile): { runId: string; pid: number } | null {
    try {
      const runId = randomUUID();
      const child = execFile(profile.command, profile.args, {
        cwd: profile.cwd,
        shell: false,
        windowsHide: false,
      });
      const pid = child.pid!;
      const state: RunState = {
        runId, profileId: profile.id, pid, status: 'running', exitCode: null, startedAt: Date.now(),
      };
      this.runs.set(runId, { child, state });
      // 日志捕获（子项目 C）：stdout/stderr 合流进 ring buffer；退出时 flush 半截行
      const buf = createLogBuffer();
      this.logs.set(runId, buf);
      const onData = (chunk: Buffer | string) => appendLogChunk(buf, String(chunk));
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('exit', (code) => {
        flushLog(buf);
        const r = this.runs.get(runId);
        if (r) {
          r.state.status = 'exited';
          r.state.exitCode = code;
          this.onUpdate(r.state);
        }
      });
      return { runId, pid };
    } catch (e) {
      console.error('RunManager.start failed:', e);
      return null;
    }
  }

  /** 增量读日志；未知 runId → null（渲染层据此提示「日志不可用」）。 */
  getLogs(runId: string, sinceSeq = 0): RunLogChunk | null {
    const buf = this.logs.get(runId);
    return buf ? readLog(buf, sinceSeq) : null;
  }
  // stop/restart/getState/allStates 不变
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `cd app && pnpm vitest run tests/runProfiles.test.ts`
Expected: PASS（集成用例含真实 spawn，约 1s）

```bash
git add app/electron/runProfiles.ts app/tests/runProfiles.test.ts
git commit -m "feat(app): RunManager captures stdout/stderr per run with incremental getLogs"
```

---

### Task 3: IPC 接线

**Files:**
- Modify: `app/electron/ipc-types.ts`、`app/electron/preload.ts`、`app/electron/main.ts`、`app/src/lib/ipc.ts`

- [ ] **Step 1: ipc-types**

`IPC` 常量（`RUN_UPDATE` 后）加：

```ts
  // run 日志（子项目 C）：增量拉取某 run 的 stdout/stderr ring buffer
  RUN_GET_LOGS: 'run:getLogs',
```

`ExposedApi`（`onRunUpdate` 后）加：

```ts
  // run 日志（子项目 C）。sinceSeq 传上次的 nextSeq 得增量；null=未知 runId。
  getRunLogs(runId: string, sinceSeq?: number): Promise<RunLogChunk | null>;
```

- [ ] **Step 2: preload**

```ts
  getRunLogs: (runId: string, sinceSeq?: number) => ipcRenderer.invoke(IPC.RUN_GET_LOGS, runId, sinceSeq),
```

- [ ] **Step 3: main.ts**（RUN_RESTART handler 之后）

```ts
ipcMain.handle(IPC.RUN_GET_LOGS, (_evt, runId: string, sinceSeq?: number) => {
  try { return runManager.getLogs(runId, sinceSeq ?? 0); }
  catch (e) { console.error('run:getLogs failed:', e); return null; }
});
```

- [ ] **Step 4: lib/ipc**

```ts
  getRunLogs: (...a) => invoke('getRunLogs', ...a),
```

- [ ] **Step 5: typecheck + Commit**

```bash
git add app/electron/ipc-types.ts app/electron/preload.ts app/electron/main.ts app/src/lib/ipc.ts
git commit -m "feat(app): wire run:getLogs IPC channel"
```

---

### Task 4: 渲染层合并纯函数（TDD）

**Files:**
- Create: `app/src/lib/runLogs.ts`
- Test: `app/tests/runLogs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { createRunLogViewState, mergeLogChunk, MAX_RENDER_LOG_LINES } from '../src/lib/runLogs';

describe('mergeLogChunk', () => {
  it('追加新行并更新 nextSeq/droppedBefore', () => {
    const s0 = createRunLogViewState();
    const s1 = mergeLogChunk(s0, { lines: [{ seq: 1, text: 'a' }, { seq: 2, text: 'b' }], droppedBefore: 0, nextSeq: 2 });
    expect(s1.lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(s1.nextSeq).toBe(2);
    const s2 = mergeLogChunk(s1, { lines: [{ seq: 3, text: 'c' }], droppedBefore: 4, nextSeq: 3 });
    expect(s2.lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(s2.droppedBefore).toBe(4);
  });

  it('幂等：重复 chunk 不产生重复行', () => {
    const s0 = createRunLogViewState();
    const chunk = { lines: [{ seq: 1, text: 'a' }], droppedBefore: 0, nextSeq: 1 };
    const s1 = mergeLogChunk(s0, chunk);
    const s2 = mergeLogChunk(s1, chunk);
    expect(s2.lines).toHaveLength(1);
  });

  it('渲染层也封顶（防长驻面板内存膨胀）', () => {
    const s0 = createRunLogViewState();
    const lines = Array.from({ length: MAX_RENDER_LOG_LINES + 50 }, (_, i) => ({ seq: i + 1, text: `l${i + 1}` }));
    const s1 = mergeLogChunk(s0, { lines, droppedBefore: 0, nextSeq: lines.length });
    expect(s1.lines).toHaveLength(MAX_RENDER_LOG_LINES);
    expect(s1.lines[0]!.text).toBe('l51');
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// run 日志视图状态合并（子项目 C）：增量去重 + 渲染层封顶。
import type { RunLogLine, RunLogChunk } from '../../electron/ipc-types';

export const MAX_RENDER_LOG_LINES = 2000;

export interface RunLogViewState {
  lines: RunLogLine[];
  droppedBefore: number;
  nextSeq: number; // 已收到的最大 seq；下次拉取 sinceSeq 传它
}

export function createRunLogViewState(): RunLogViewState {
  return { lines: [], droppedBefore: 0, nextSeq: 0 };
}

/** 合并增量块：只收 seq > prev.nextSeq 的行（幂等），渲染层封顶 2000 行。 */
export function mergeLogChunk(prev: RunLogViewState, chunk: RunLogChunk): RunLogViewState {
  const fresh = chunk.lines.filter((l) => l.seq > prev.nextSeq);
  const lines = fresh.length ? [...prev.lines, ...fresh] : prev.lines;
  return {
    lines: lines.length > MAX_RENDER_LOG_LINES ? lines.slice(-MAX_RENDER_LOG_LINES) : lines,
    droppedBefore: chunk.droppedBefore,
    nextSeq: chunk.nextSeq,
  };
}
```

- [ ] **Step 4: PASS + Commit**

```bash
git add app/src/lib/runLogs.ts app/tests/runLogs.test.ts
git commit -m "feat(app): renderer run-log merge (dedupe by seq, 2000-line cap)"
```

---

### Task 5: RunLogView 组件（TDD）

**Files:**
- Create: `app/src/components/RunLogView.tsx`
- Test: `app/tests/runLogView.test.tsx`

- [ ] **Step 1: 写失败测试**（mock 范式照 AutoLaunchToggle）

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunLogView } from '../src/components/RunLogView';

function mockGetRunLogs(impl: (runId: string, sinceSeq: number) => Promise<unknown>) {
  Object.defineProperty(window, 'codemgr', {
    value: { getRunLogs: vi.fn(impl) },
    writable: true, configurable: true,
  });
  return (window as unknown as { codemgr: { getRunLogs: ReturnType<typeof vi.fn> } }).codemgr.getRunLogs;
}

describe('RunLogView', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('挂载全量拉取（sinceSeq=0）并渲染行与丢弃提示', async () => {
    mockGetRunLogs(async () => ({
      lines: [{ seq: 1, text: 'ready in 300ms' }, { seq: 2, text: 'listening :3000' }],
      droppedBefore: 12, nextSeq: 2,
    }));
    render(<RunLogView runId="r1" />);
    await waitFor(() => expect(screen.getByText('ready in 300ms')).toBeInTheDocument());
    expect(screen.getByText('listening :3000')).toBeInTheDocument();
    expect(screen.getByText(/已丢弃早期 12 行/)).toBeInTheDocument();
  });

  it('增量拉取传上次 nextSeq；清空仅清本地视图', async () => {
    const fn = mockGetRunLogs(async (_r: string, since: number) => since === 0
      ? { lines: [{ seq: 1, text: 'first' }], droppedBefore: 0, nextSeq: 1 }
      : { lines: [], droppedBefore: 0, nextSeq: 1 });
    render(<RunLogView runId="r1" />);
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
    expect(fn).toHaveBeenCalledWith('r1', 0);
    fireEvent.click(screen.getByRole('button', { name: '清空本地日志视图' }));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('暂无输出')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```tsx
import { useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import { createRunLogViewState, mergeLogChunk, type RunLogViewState } from '../lib/runLogs';

const POLL_MS = 2000;

/**
 * Run 日志视图（子项目 C）：挂载全量拉，之后 2s 增量（busyRef 防重入 + 卸载清理）。
 * 跟随滚动：用户停在上翻位置时不拽回；回到底部附近后新行继续自动跟随。
 * 「清空」只清本地视图（main cursor 不动），不会触发全量重拉。
 */
export function RunLogView({ runId }: { runId: string }) {
  const [state, setState] = useState<RunLogViewState>(createRunLogViewState);
  const [fetchError, setFetchError] = useState(false);
  const boxRef = useRef<HTMLPreElement>(null);
  const atBottomRef = useRef(true);
  const busyRef = useRef(false);
  const nextSeqRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    setState(createRunLogViewState());
    setFetchError(false);
    nextSeqRef.current = 0;
    atBottomRef.current = true;

    async function tick() {
      if (busyRef.current || stopped) return;
      busyRef.current = true;
      try {
        const chunk = await ipc.getRunLogs(runId, nextSeqRef.current);
        if (stopped || chunk === null) return;
        setState((prev) => {
          const next = mergeLogChunk(prev, chunk);
          nextSeqRef.current = next.nextSeq;
          return next;
        });
        setFetchError(false);
      } catch {
        if (!stopped) setFetchError(true);
      } finally {
        busyRef.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [runId]);

  // 跟随滚动：仅当视口在底部附近时，新行到达自动滚到底
  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.lines]);

  function onScroll() {
    const el = boxRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  return (
    <div className="mt-2 rounded border border-base-700 bg-base-900">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-fg-muted">
        <span>
          {state.lines.length} 行
          {state.droppedBefore > 0 ? ` · 已丢弃早期 ${state.droppedBefore} 行` : ''}
          {fetchError ? ' · 日志拉取出错' : ''}
        </span>
        <button
          aria-label="清空本地日志视图"
          onClick={() => setState(createRunLogViewState())}
          className="rounded px-1 hover:bg-base-700 hover:text-fg-primary"
        >
          清空
        </button>
      </div>
      <pre
        ref={boxRef}
        onScroll={onScroll}
        className="max-h-64 overflow-auto px-2 py-1 font-mono text-[11px] leading-4 text-fg-secondary"
      >
        {state.lines.length === 0
          ? '暂无输出'
          : state.lines.map((l) => <div key={l.seq}>{l.text === '' ? ' ' : l.text}</div>)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: PASS + Commit**

Run: `cd app && pnpm vitest run tests/runLogView.test.tsx`
Expected: PASS

```bash
git add app/src/components/RunLogView.tsx app/tests/runLogView.test.tsx
git commit -m "feat(app): run log view component (incremental poll, follow scroll, local clear)"
```

---

### Task 6: RunProfilesPanel 集成 + 收口

**Files:**
- Modify: `app/src/components/RunProfilesPanel.tsx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 集成**

import 加 `import { RunLogView } from './RunLogView';`。组件内 state 区加：

```tsx
  const [logOpenFor, setLogOpenFor] = useState<string | null>(null); // 展开日志的 profileId（一次一行）
  const latestRunOf = (profileId: string) =>
    runs.filter((r) => r.profileId === profileId).at(-1) ?? null;
```

行按钮区（「删」按钮后）加：

```tsx
                      {latestRunOf(p.id) && (
                        <button
                          onClick={() => setLogOpenFor(logOpenFor === p.id ? null : p.id)}
                          className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600"
                        >
                          {logOpenFor === p.id ? '收起日志' : '日志'}
                        </button>
                      )}
```

profile 卡片内（`</div>` 收尾前，命令行/cwd 两行之后）加：

```tsx
                  {logOpenFor === p.id && latestRunOf(p.id) && (
                    <RunLogView runId={latestRunOf(p.id)!.runId} />
                  )}
```

- [ ] **Step 2: 全量回归 + CHANGELOG**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: 全 PASS

CHANGELOG `[Unreleased]` 节追加：

```markdown
- **RunProfile 日志闭环**：启动的开发服务 stdout/stderr 按 run 捕获进 ring buffer（2000 行上限，退出后保留，ANSI 转义剥离）；profile 行可展开日志视图（2s 增量拉取、跟随滚动、丢弃行数提示、本地清空）。新增 `run:getLogs` IPC 通道。
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/RunProfilesPanel.tsx CHANGELOG.md
git commit -m "feat(app): run profile log viewer wired into panel; changelog"
```

---

## Self-Review 记录

- Spec §3.1 buffer 纯函数 → Task 1；§3.2 RunManager 挂接 → Task 2；§4 IPC → Task 3；§5.1 合并函数 → Task 4；§5.2 RunLogView → Task 5；§5.3 面板集成 → Task 6；§6 测试 → 各 Task 内。
- 类型一致性：`RunLogLine/RunLogChunk` 在 Task 1 于 ipc-types 定义，Task 1-5 全部复用；`readLog.nextSeq = nextSeq-1`（已分配最大 seq）与 Task 4 mergeLogChunk 的 `seq > prev.nextSeq` 去重、Task 5 `sinceSeq=nextSeqRef` 语义三方一致。
- 风险：Task 2 集成测试真实 spawn node——CI/本机必有 node（仓库工具链依赖），超时 10s 兜底。
