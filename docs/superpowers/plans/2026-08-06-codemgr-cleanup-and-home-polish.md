# 性能优化动作深化 + 首页打磨（Cleanup & Home Polish）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一键清理闭环（cleanupScanner + CleanupDialog + 首页入口）与首页打磨 6 项（失败态/趋势/盘符/陈旧提示/空态/文档）。

**Architecture:** 纯函数扫描器（TDD）→ 对话框组件 → 首页集成；打磨项全部为 HomePanel/homeStore 局部改动。零 native、零新 IPC（killByPids 已有）。

**Tech Stack:** React 18 + Zustand + Tailwind + vitest。基于 `feat/cleanup-home-polish` 分支（已建，基于 main 517e1c4）。

**关键事实（已核实）：**
- `Dialog` props：`{ open, onOpenChange, title, description?, children }`（ui/Dialog.tsx:6-29）
- `ipc.killByPids(pids: number[])` → `KillOutcome[]`（`{ pid, status: 'killed'|'protected'|'denied'|'not-found' }`）
- `killConfirm.ts`：`KILL_LIST_CAP = 15`、`summarizeKillOutcomes(outcomes)` → `{killed, protected, denied, notFound}`、`formatKillFailureSummary(s)`（已导出）
- `perfStore.history: PerfHistoryPoint[]`（60 点，`{ t, cpuTotal, memUsedPercent, gpuTotal }`）；`perfStore.staleAt: number | null`
- `homeStore`：`{ assessment, issues, detector, running, refresh(): Promise<void>, setRunning, reset }`——refresh 已含自驱采样（布局叶子门控）+ detector/assess 计算
- `StateView` props：`{ state, title, description? }`（无 children）——重试按钮需包外层
- `Issue`：`{ id, rule, severity, title, detail, processId?, action }`；issue 规则 `'process-cpu' | 'memory-growth'` 带 processId
- `ProcessInfo`（渲染层）：`{ pid, name, workingSetBytes, ... }`，**无 cpuPercent**（用 `processPanelStore.cpuMap`）
- HomePanel 快速动作区：三个 Button（查看高占用/结束异常进程/打开性能详情）+ 加载态（assessment null → StateView loading）

**测试命令（app 目录）：** `npx vitest run <file>`；全量 `pnpm vitest run`；`pnpm typecheck`。

---

### Task 1: cleanupScanner 纯函数（TDD）

**Files:**
- Create: `app/src/lib/cleanupScanner.ts`
- Test: `app/tests/cleanupScanner.test.ts`

- [ ] **Step 1: 写失败测试**（`app/tests/cleanupScanner.test.ts`）：

```ts
import { describe, it, expect } from 'vitest';
import { scanCleanupCandidates, CLEANUP_LIST_CAP } from '../src/lib/cleanupScanner';
import type { ProcessInfo } from '../electron/ipc-types';
import type { Issue } from '../src/lib/issueDetector';

const proc = (pid: number, name: string, mem: number): ProcessInfo =>
  ({ pid, ppid: 0, name, cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: mem, createTimeMs: 0, threadCount: 1, handleCount: 1 });
const issue = (pid: number, rule: 'process-cpu' | 'memory-growth'): Issue =>
  ({ id: `${rule}:${pid}`, rule, severity: 'attention', title: 't', detail: 'd', processId: pid, action: 'locate-process' });

describe('scanCleanupCandidates', () => {
  it('issue 目标（process-cpu/memory-growth）进入候选', () => {
    const procs = [proc(42, 'node.exe', 5e8), proc(7, 'a.exe', 3e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: { 42: 120, 7: 5 }, issues: [issue(42, 'process-cpu')] });
    expect(out.map((c) => c.pid)).toEqual([42]);
    expect(out[0].reason).toBe('issue-target');
    expect(out[0].cpuPercent).toBe(120);
  });

  it('大内存（>1.5GB 默认）进入候选，按内存降序', () => {
    const procs = [proc(1, 'big.exe', 2e9), proc(2, 'mid.exe', 1e9), proc(3, 'huge.exe', 3e9)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [] });
    expect(out.map((c) => c.pid)).toEqual([3, 1]);
    expect(out.every((c) => c.reason === 'large-memory')).toBe(true);
  });

  it('issue 目标排在大内存前（优先级）', () => {
    const procs = [proc(1, 'big.exe', 2e9), proc(2, 'issue.exe', 1e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [issue(2, 'memory-growth')] });
    expect(out.map((c) => c.pid)).toEqual([2, 1]);
  });

  it('已退出进程（issue 有但快照无）剔除', () => {
    const procs = [proc(42, 'node.exe', 5e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [issue(42, 'process-cpu'), issue(99, 'memory-growth')] });
    expect(out.map((c) => c.pid)).toEqual([42]);
  });

  it('保留 pid 0/4/8 排除（即使大内存）', () => {
    const procs = [proc(0, 'System Idle', 0), proc(4, 'System', 3e9), proc(8, 'Registry', 2e9), proc(42, 'node.exe', 4e9)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [] });
    expect(out.map((c) => c.pid)).toEqual([42]);
  });

  it('上限 CLEANUP_LIST_CAP=15', () => {
    const procs = Array.from({ length: 30 }, (_, i) => proc(100 + i, `p${i}.exe`, 2e9));
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [] });
    expect(out).toHaveLength(CLEANUP_LIST_CAP);
    expect(CLEANUP_LIST_CAP).toBe(15);
  });

  it('自定义大内存阈值', () => {
    const procs = [proc(1, 'a.exe', 5e8), proc(2, 'b.exe', 9e8)];
    const out = scanCleanupCandidates({ processes: procs, cpuMap: {}, issues: [], largeMemoryBytes: 8e8 });
    expect(out.map((c) => c.pid)).toEqual([2]);
  });
});
```

- [ ] **Step 2: 运行确认失败**：`cd "E:\A_Project\codemgr/app" && npx vitest run tests/cleanupScanner.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（`app/src/lib/cleanupScanner.ts`）：

```ts
import type { ProcessInfo } from '../../electron/ipc-types';
import type { Issue } from './issueDetector';

export type CleanupReason = 'issue-target' | 'large-memory';

export interface CleanupCandidate {
  pid: number;
  name: string;
  reason: CleanupReason;
  cpuPercent: number;   // 0-100 相对单核（cpuMap 取值，缺省 0）
  memoryBytes: number;
}

export const CLEANUP_LIST_CAP = 15;
export const DEFAULT_LARGE_MEMORY_BYTES = 1.5 * 1024 * 1024 * 1024;
/** Idle/System/Registry 等内核保留 pid，永不列入清理候选（其余保护由 native IsProtected 兜底） */
const RESERVED_PIDS = new Set([0, 4, 8]);
const ISSUE_RULES: ReadonlySet<Issue['rule']> = new Set(['process-cpu', 'memory-growth']);

export interface CleanupScanInput {
  processes: ProcessInfo[];
  cpuMap: Record<number, number>;
  issues: Issue[];
  largeMemoryBytes?: number;
}

export function scanCleanupCandidates(input: CleanupScanInput): CleanupCandidate[] {
  const { processes, cpuMap, issues, largeMemoryBytes = DEFAULT_LARGE_MEMORY_BYTES } = input;
  const byPid = new Map(processes.filter((p) => !RESERVED_PIDS.has(p.pid)).map((p) => [p.pid, p]));
  const issuePids = new Set(
    issues.filter((i) => ISSUE_RULES.has(i.rule) && i.processId !== undefined && byPid.has(i.processId!))
      .map((i) => i.processId!),
  );
  const candidates: CleanupCandidate[] = [];
  for (const pid of issuePids) {
    const p = byPid.get(pid)!;
    candidates.push({ pid, name: p.name, reason: 'issue-target', cpuPercent: cpuMap[pid] ?? 0, memoryBytes: p.workingSetBytes });
  }
  for (const [pid, p] of byPid) {
    if (issuePids.has(pid)) continue;
    if (p.workingSetBytes > largeMemoryBytes) {
      candidates.push({ pid, name: p.name, reason: 'large-memory', cpuPercent: cpuMap[pid] ?? 0, memoryBytes: p.workingSetBytes });
    }
  }
  // issue-target 优先，其余按内存降序
  return candidates
    .sort((a, b) => (a.reason === b.reason ? b.memoryBytes - a.memoryBytes : a.reason === 'issue-target' ? -1 : 1))
    .slice(0, CLEANUP_LIST_CAP);
}
```

- [ ] **Step 4: 运行确认通过**：`npx vitest run tests/cleanupScanner.test.ts && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/lib/cleanupScanner.ts app/tests/cleanupScanner.test.ts
git commit -m "feat(app): cleanup scanner with issue-target and large-memory rules"
```

---

### Task 2: homeStore 失败态（B1 前置，TDD）

**Files:**
- Modify: `app/src/store/homeStore.ts`
- Test: `app/tests/useHome.test.tsx`

- [ ] **Step 1: 写失败测试**（`app/tests/useHome.test.tsx` 追加）：

```tsx
  it('自驱采样连续失败 3 次置 error，成功恢复清除', async () => {
    // mock fetchPerf 连续返回失败（r.ok === false 或 reject——按现有 mockIpc 模式）
    // 布局 root='home'（自驱采样路径），推进 3 个 tick
    // 断言 useHomeStore.getState().error 非 null；然后 mock 成功，推进 1 tick，error 清空
  });
```

（mock 失败/成功的切换方式：Read 现有 useHome.test.tsx 的 mockIpc 用法——若 fetchPerf 用 vi.mocked(ipc.fetchPerf) 可 mockResolvedValueOnce 序列；以文件内现有模式为准实现。）

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/useHome.test.tsx`
Expected: FAIL（error 字段不存在）

- [ ] **Step 3: 实现**（homeStore.ts）：

```ts
// state 增加：
error: string | null;
// 模块级：
let sampleFailStreak = 0;
const SAMPLE_FAIL_LIMIT = 3;

// refresh 内自驱采样路径：fetch 失败时 sampleFailStreak++；成功时 sampleFailStreak = 0
// 每轮末尾（计算前）：
const error = sampleFailStreak >= SAMPLE_FAIL_LIMIT ? '连续多次获取系统数据失败' : null;
set({ assessment, issues, error });
// reset() 同步重置 sampleFailStreak = 0 与 error: null
```

（实现细节：sampleFailStreak 计数只统计自驱采样失败（面板挂载路径无此概念，perfStore.error 由面板自己管理）；refresh 开头读 perf 前保持 error 语义为「上一轮状态」，计算成功后清。）

- [ ] **Step 4: 运行确认通过**：`npx vitest run tests/useHome.test.tsx && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/store/homeStore.ts app/tests/useHome.test.tsx
git commit -m "feat(app): home error state after repeated sampling failures"
```

---

### Task 3: CleanupDialog 组件

**Files:**
- Create: `app/src/components/CleanupDialog.tsx`
- Test: `app/tests/CleanupDialog.test.tsx`

- [ ] **Step 1: 写渲染测试**（`app/tests/CleanupDialog.test.tsx`）：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CleanupDialog } from '../src/components/CleanupDialog';
import { ToastHost } from '../src/components/ToastHost';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useHomeStore } from '../src/store/homeStore';
import { ipc } from '../src/lib/ipc';
import { __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => {
  __resetToastStoreForTests();
  useProcessPanelStore.getState().reset();
  useHomeStore.getState().reset();
  vi.restoreAllMocks();
});

const seed = () => {
  useProcessPanelStore.setState({
    processes: [{ pid: 42, ppid: 0, name: 'node.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 2e9, createTimeMs: 0, threadCount: 1, handleCount: 1 }],
    cpuMap: { 42: 120 },
  } as never);
  useHomeStore.setState({ issues: [{
    id: 'process-cpu:42', rule: 'process-cpu', severity: 'attention',
    title: 'node.exe CPU 占用持续偏高', detail: 'CPU 120%', processId: 42, action: 'locate-process',
  }] } as never);
};

describe('CleanupDialog', () => {
  it('渲染候选清单（默认全选）与确认按钮', () => {
    seed();
    render(<><ToastHost /><CleanupDialog open onOpenChange={vi.fn()} /></>);
    expect(screen.getByText('node.exe')).toBeInTheDocument();
    expect(screen.getByText(/将结束 1 个进程/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('确认调用 killByPids 并 toast 反馈', async () => {
    seed();
    const kill = vi.spyOn(ipc, 'killByPids').mockResolvedValue([{ pid: 42, status: 'killed' }] as never);
    render(<><ToastHost /><CleanupDialog open onOpenChange={vi.fn()} /></>);
    fireEvent.click(screen.getByRole('button', { name: /确认清理/ }));
    expect(kill).toHaveBeenCalledWith([42]);
    expect(await screen.findByText(/已清理 1 个进程/)).toBeInTheDocument();
  });

  it('无候选时确认禁用并提示', () => {
    render(<><ToastHost /><CleanupDialog open onOpenChange={vi.fn()} /></>);
    expect(screen.getByText(/暂无可清理进程/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认清理/ })).toBeDisabled();
  });

  it('取消不执行', () => {
    seed();
    const onClose = vi.fn();
    const kill = vi.spyOn(ipc, 'killByPids').mockResolvedValue([] as never);
    render(<><ToastHost /><CleanupDialog open onOpenChange={onClose} /></>);
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(kill).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
```

（组件 prop 名与测试选择器以实际实现为准微调；killByPids 类型返回按 ipc-types 的 KillOutcome[]。）

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/CleanupDialog.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（`app/src/components/CleanupDialog.tsx`）：

要点（照 spec §3.2）：
- props：`{ open: boolean; onOpenChange: (open: boolean) => void }`
- 打开时（open 变 true）从 `useProcessPanelStore.getState()`（processes/cpuMap）+ `useHomeStore.getState().issues` 取快照 → `scanCleanupCandidates`（memo：`useMemo` 依赖 open 与快照——打开瞬间计算一次即可，不随 2s tick 重算：用 `useState` 在 open 翻转时初始化候选列表）
- 清单行：`<input type="checkbox">`（checked 状态本地 state，初始全选）+ name + PID + CPU% + 格式化内存（`formatBytes` 复用——grep 找既有格式化函数如 `formatBytes`，无则行内 MB/GB 格式化）+ 理由 Badge（issue-target → `Badge tone="warning"`「检测异常」；large-memory → `Badge tone="neutral"`「大内存」）
- 底部：`将结束 {n} 个进程`（n=勾选数）+ 取消/`确认清理` Button（variant dangerQuiet？ProcessPanel 批量 kill 确认按钮样式照抄）；busy 时禁用
- 执行：`const outcomes = await ipc.killByPids(selectedPids)` → `summarizeKillOutcomes` → 全 killed `notify.success(\`已清理 ${killed} 个进程\`)`；部分 `notify.warning(\`已清理 ${killed}/${total} 个进程（${formatKillFailureSummary(s)}）\`)`；全败 `notify.error(\`未清理任何进程：${formatKillFailureSummary(s) || '全部失败'}\`)`（照 ProcessPanel 批量 kill 文案模式）→ 关闭
- Dialog 用法：`<Dialog open={open} onOpenChange={onOpenChange} title="一键优化" description="清理检测异常与大内存占用的进程">`

- [ ] **Step 4: 运行确认通过**：`npx vitest run tests/CleanupDialog.test.tsx && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/CleanupDialog.tsx app/tests/CleanupDialog.test.tsx
git commit -m "feat(app): cleanup dialog with candidate list and kill flow"
```

---

### Task 4: HomePanel 集成（一键优化 + 打磨 5 项）

**Files:**
- Modify: `app/src/components/HomePanel.tsx`
- Test: `app/tests/HomePanel.test.tsx`

- [ ] **Step 1: 写失败测试**（HomePanel.test.tsx 追加）：

```tsx
  it('快速动作含「一键优化」并打开清理对话框', () => {
    // seed 数据 + useLayoutStore root 含 process（同步路径）或直接 seed homeStore
    render(<><ToastHost /><HomePanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '一键优化' }));
    expect(screen.getByText('暂无可清理进程')).toBeInTheDocument(); // Dialog 打开（无候选时）
  });

  it('自驱采样失败态：错误视图 + 重试按钮', () => {
    useHomeStore.setState({ assessment: null, error: '连续多次获取系统数据失败' });
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('无法获取系统状态')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    // 断言 refresh 被调用（spyOn useHomeStore.getState().refresh 或通过后续 state 变化）
  });

  it('CPU 卡显示趋势箭头', () => {
    // perfStore.history 种子末两点 cpuTotal 递增 → 断言 ↑ 出现
  });

  it('磁盘卡显示盘符', () => {
    // perf.disks 最小剩余盘为 C: → 断言 'C:' 出现
  });

  it('无问题时正向空态', () => {
    useHomeStore.setState({ assessment: { level: 'excellent', reasons: [] }, issues: [] });
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('各项指标正常')).toBeInTheDocument();
  });
```

（以现有 HomePanel.test.tsx 的 seed/布局模式为基准实现；趋势/盘符用例的 perf 种子照 useHome.test.tsx 的 seedPerf 形状。）

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/HomePanel.test.tsx`
Expected: 失败（新断言无对应实现）

- [ ] **Step 3: 实现**（HomePanel.tsx）：

- 快速动作区加「一键优化」`Button variant="primary" size="sm"`（放在最前），组件 state `const [cleanupOpen, setCleanupOpen] = useState(false)` → `<CleanupDialog open={cleanupOpen} onOpenChange={setCleanupOpen} />`；加载态不渲染该按钮
- B1 失败态：`assessment === null && error` 分支 → `<StateView state="error" title="无法获取系统状态" description={error} />` + 外层 flex 容器内 `Button variant="secondary" size="sm"`「重试」→ `void useHomeStore.getState().refresh()`
- B2 趋势：CPU/内存卡值下方 `<span>` 箭头——从 `usePerfStore((s) => s.history)` 取末两点（`h.length >= 2`）：`cpuTotal` 上升 → `↑`（text-danger）/下降 → `↓`（text-success）/持平或无历史不显示；内存同（memUsedPercent）
- B3 盘符：磁盘卡值改「{minDiskName}: {pct}%」（perf.disks 中剩余最小的盘的 name）
- B4 陈旧提示：`usePerfStore((s) => s.staleAt)` 距今 >5000ms 时，卡片区顶部 `<PanelAlert tone="info">数据陈旧（{formatTime(staleAt)} 起）</PanelAlert>`（formatTime 行内 HH:MM:SS）
- B5 空态：无 issues 时 `<div className="flex items-center justify-center gap-1.5 px-3 py-6 text-xs text-content-muted"><CheckCircle2 size={14} aria-hidden="true" />各项指标正常</div>`（CheckCircle2 从 icons facade 导入）

- [ ] **Step 4: 运行确认通过**：`npx vitest run tests/HomePanel.test.tsx && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/HomePanel.tsx app/tests/HomePanel.test.tsx
git commit -m "feat(app): home cleanup entry, error state, trend/disk/stale/empty polish"
```

---

### Task 5: 文档收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-codemgr-steward-home-design.md`（B6 措辞）
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`（§8）

- [ ] **Step 1: spec 措辞**（B6）：`2026-08-01-codemgr-steward-home-design.md` §10 验收清单 ⑤「system:diskUsage 接线完成」→「磁盘数据复用 perf.disks（§5 修订，零新 IPC）」

- [ ] **Step 2: CHANGELOG** `[Unreleased]` 节追加（在 steward home 条目下新增小节或并入）：

```markdown
### 性能优化动作 + 首页打磨（2026-08-06）
- 首页「一键优化」：清理对话框列出检测异常（CPU 持续高/内存增长）与大内存（>1.5GB）进程候选（上限 15，默认全选），确认后批量结束并 toast 反馈（全成/部分/全败）；内核保留进程（Idle/System/Registry）与 native 保护名单双重兜底。
- 首页打磨：自驱采样连续失败显示错误态 + 重试；CPU/内存卡趋势箭头；磁盘卡显示盘符；数据陈旧提示条；无问题正向空态。
```

- [ ] **Step 3: AGENTS.md §8**：v2.5 条目末尾追加一句「一键优化清理对话框 + 首页打磨（失败态/趋势/盘符/陈旧/空态）」；测试数更新（Step 跑完拿实数，格式 `app X/X + native 51/51，共 Y PASS`）

- [ ] **Step 4: 提交**

```bash
cd "E:\A_Project\codemgr" && git add docs/superpowers/specs/2026-08-01-codemgr-steward-home-design.md CHANGELOG.md AGENTS.md
git commit -m "docs: record cleanup action and home polish iteration"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 全量测试 + typecheck**：`cd "E:\A_Project\codemgr/app" && pnpm vitest run 2>&1 | tail -3 && pnpm typecheck`
Expected: 全 PASS（627 + 新增约 16-18）、typecheck 干净

- [ ] **Step 2: native 确认未动**：`git diff main..HEAD --stat -- codemgr-native/` → 空

- [ ] **Step 3: 人工验收清单交付**（spec §7 逐项）：

- [ ] 首页「一键优化」打开对话框，候选含检测异常与大内存进程，默认全选
- [ ] 确认后 killByPids 执行，toast 区分全成/部分/全败
- [ ] 无候选提示 + 确认禁用
- [ ] 自驱采样连续失败 → 错误态 + 重试恢复
- [ ] CPU/内存趋势箭头、磁盘盘符、陈旧提示条
- [ ] 无问题正向空态
- [ ] spec 措辞修正
- [ ] app 全量通过 + typecheck + native 51 不变

---

## Self-Review 记录

- **Spec 覆盖**：§3.1 scanner（T1）✓；§3.2 dialog（T3）✓；§3.3 首页入口（T4）✓；§3.4 反馈（T3 内）✓；§4 B1（T2+T4）✓、B2-B5（T4）✓、B6（T5）✓；§5 测试（各任务内嵌）✓；§7 验收（T6）✓。
- **占位符**：T2 测试用例为语义描述 + 指引（mock 模式以现有文件为准）——实现者必须先 Read useHome.test.tsx 再写；T3/T4 测试同样标注「以现有模式为基准微调」，非空泛占位。
- **类型一致性**：CleanupCandidate/CleanupScanInput 在 T1 定义、T3 消费；homeStore.error 在 T2 定义、T4 消费；`ipc.killByPids` 返回 KillOutcome[] 贯穿 T3。
