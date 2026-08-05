# 电脑管家首页（Steward Home）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「首页」面板（性能与状态评估总览，电脑管家隐喻）：评估模型 + 检测引擎 + 四区仪表盘 + 导航接入，作为默认首屏。

**Architecture:** 纯 TS 规则层（healthAssess 评估模型 + IssueDetector 检测引擎，TDD）消费现有轮询数据（perfStore / processPanelStore，磁盘复用 `PerfData.disks` 免新 IPC）；homeStore 持有计算结果；HomePanel 四区渲染；导航经 panelCatalog 加 `home` 面板（监控组第一）+ classic 预设根节点改 `home`。联动复用 layoutStore.openPanel + processPanelStore.selectAll。

**Tech Stack:** React 18 + Zustand + Tailwind 语义令牌 + vitest。零 native 改动、零新 IPC。

**执行前提：** 基于 `feat/display-consistency` 分支（其内容未 push——本机代理故障，见前文；本计划在本地分支上叠加，push 恢复后一起推）。建分支：`git checkout -b feat/steward-home`。所有提交精确 `git add <file>`，**绝不 `git add -A`**。UTF-8 中文文件用 Read/Edit 工具。

**关键事实（已核实）：**
- `PerfData`: `{ cpu: { totalPercent, perCore[] }, memory: { totalBytes, availableBytes, usedPercent }, disks: [{ name, totalBytes, freeBytes, readBytesPerSec, writeBytesPerSec, activePercent }], networks: [...], gpu: {...} }`（`../codemgr-native/index.ts:44-56`）
- `ProcessInfo`: `{ pid, ppid, name, cmdline, cpuPercent /*0-100 相对单核*/, workingSetBytes, ... }`
- `processPanelStore`: 已有 `procHistory: Record<pid, ProcHistoryPoint[]>（{ts, cpu, mem} 滚动窗口）` 与 `selectAll(pids)`/`clearSelection`/`toggleSelect`
- `perfStore`: `current: PerfData | null`, `history: PerfHistoryPoint[]`（60 点）, `pollMs`
- `LAYOUT_PRESETS.classic = 'process'`（`src/store/layoutStore.ts:150-152`）
- `panelCatalog.tsx` 的 `BUILTIN_PANEL_DEFINITIONS` 现 7 项；`startup` 在 `group: 'workflow'`
- workspaceNavigation.test.tsx 断言：monitoring=[端口雷达,进程,性能]、workflow=[快照,AI 会话,运行配置,启动项]（需更新）

**测试命令（app 目录）：** `npx vitest run <file>`；全量 `pnpm vitest run`；`pnpm typecheck`。

---

### Task 1: 评估模型 healthAssess（纯函数 TDD）

**Files:**
- Create: `app/src/lib/healthAssess.ts`
- Test: `app/tests/healthAssess.test.ts`

- [ ] **Step 1: 写失败测试**（`app/tests/healthAssess.test.ts`，全组合覆盖）：

```ts
import { describe, it, expect } from 'vitest';
import { assessHealth, type HealthInput } from '../src/lib/healthAssess';

const base: HealthInput = { cpuPercent: 20, memPercent: 40, diskFreeMinPercent: 50, gpuPercent: null, issueCount: 0 };

describe('assessHealth', () => {
  it('全部正常 → excellent，无 reasons', () => {
    const r = assessHealth(base);
    expect(r.level).toBe('excellent');
    expect(r.reasons).toEqual([]);
  });

  it('单指标 attention → good + 对应 reason', () => {
    const r = assessHealth({ ...base, memPercent: 75 });
    expect(r.level).toBe('good');
    expect(r.reasons).toEqual(['内存使用率 75%']);
  });

  it('最差指标主导：磁盘 8% → alert', () => {
    const r = assessHealth({ ...base, diskFreeMinPercent: 8 });
    expect(r.level).toBe('alert');
    expect(r.reasons).toContain('磁盘剩余 8%');
  });

  it('issueCount>=2 且整体 good → 降一档 attention', () => {
    const r = assessHealth({ ...base, memPercent: 75, issueCount: 2 });
    expect(r.level).toBe('attention');
  });

  it('issueCount 修正不越过 alert：alert 指标 + 多问题仍 alert', () => {
    const r = assessHealth({ ...base, memPercent: 90, issueCount: 3 });
    expect(r.level).toBe('alert');
  });

  it('边界值：内存 70 为 normal、85 为 attention', () => {
    expect(assessHealth({ ...base, memPercent: 70 }).level).toBe('excellent');
    expect(assessHealth({ ...base, memPercent: 85 }).level).toBe('good');
  });

  it('GPU null（无 GPU）不参与评估', () => {
    const r = assessHealth({ ...base, gpuPercent: null });
    expect(r.level).toBe('excellent');
  });
});
```

- [ ] **Step 2: 运行确认失败**：`cd "E:\A_Project\codemgr/app" && npx vitest run tests/healthAssess.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（`app/src/lib/healthAssess.ts`）：

```ts
export type HealthLevel = 'excellent' | 'good' | 'attention' | 'alert';

export interface HealthInput {
  cpuPercent: number;        // 系统 CPU 近期均值 0-100
  memPercent: number;        // 内存使用率 0-100
  diskFreeMinPercent: number;// 最小剩余盘百分比 0-100
  gpuPercent: number | null; // 有 GPU 时 0-100；无 GPU null（不参与）
  issueCount: number;        // 检测引擎当前问题数
}

export interface HealthAssessment {
  level: HealthLevel;
  /** 触达最差级的所有指标人话描述；excellent 时为空 */
  reasons: string[];
}

type MetricLevel = 'normal' | 'attention' | 'alert';

const METRIC_LEVEL: { name: string; value: number; attentionAt: number; alertAt: number }[] = [
  { name: 'CPU 使用率', value: 0, attentionAt: 70, alertAt: 85 },
  { name: '内存使用率', value: 0, attentionAt: 70, alertAt: 85 },
  { name: '磁盘剩余', value: 0, attentionAt: 20, alertAt: 10 }, // 剩余：<10 alert、10-20 attention（阈值反向）
  { name: 'GPU 使用率', value: 0, attentionAt: 80, alertAt: 90 },
];

export function assessHealth(input: HealthInput): HealthAssessment {
  const metrics: { label: string; level: MetricLevel }[] = [
    { label: `CPU 使用率 ${Math.round(input.cpuPercent)}%`, level: metricLevel(input.cpuPercent, 70, 85, 'high') },
    { label: `内存使用率 ${Math.round(input.memPercent)}%`, level: metricLevel(input.memPercent, 70, 85, 'high') },
    { label: `磁盘剩余 ${Math.round(input.diskFreeMinPercent)}%`, level: metricLevel(input.diskFreeMinPercent, 20, 10, 'low') },
  ];
  if (input.gpuPercent !== null) {
    metrics.push({ label: `GPU 使用率 ${Math.round(input.gpuPercent)}%`, level: metricLevel(input.gpuPercent, 80, 90, 'high') });
  }

  const worst = metrics.some((m) => m.level === 'alert') ? 'alert'
    : metrics.some((m) => m.level === 'attention') ? 'attention' : 'normal';
  // weakest link + 问题数修正（不越过 alert）
  let level: HealthLevel = worst === 'alert' ? 'alert' : worst === 'attention' ? 'good' : 'excellent';
  if (input.issueCount >= 2 && level === 'good') level = 'attention';

  const reasons = worst === 'normal'
    ? []
    : metrics.filter((m) => m.level === (worst === 'alert' ? 'alert' : 'attention')).map((m) => m.label);
  return { level, reasons };
}

function metricLevel(value: number, attentionAt: number, alertAt: number, dir: 'high' | 'low'): MetricLevel {
  const bad = (v: number, t: number) => (dir === 'high' ? v >= t : v <= t);
  if (bad(value, alertAt)) return 'alert';
  if (bad(value, attentionAt)) return 'attention';
  return 'normal';
}
```

注意：实现必须与 Step 1 测试语义一致（边界：high 方向 ≥attentionAt 即 attention；low 方向 ≤attentionAt）。reasons 只含最差级指标（alert 全列 alert 指标；attention 全列 attention 指标）。

- [ ] **Step 4: 运行确认通过**：`cd "E:\A_Project\codemgr/app" && npx vitest run tests/healthAssess.test.ts && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/lib/healthAssess.ts app/tests/healthAssess.test.ts
git commit -m "feat(app): health assessment model with transparent rules"
```

---

### Task 2: 检测引擎 IssueDetector（TDD）

**Files:**
- Create: `app/src/lib/issueDetector.ts`
- Test: `app/tests/issueDetector.test.ts`

- [ ] **Step 1: 写失败测试**：

```ts
import { describe, it, expect } from 'vitest';
import { IssueDetector, type Issue, type IssueSnapshot } from '../src/lib/issueDetector';

const baseSnapshot = (): IssueSnapshot => ({
  cpuTotalPercent: 20,
  processes: [],
  procHistory: {},
  disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 5e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
});

describe('IssueDetector', () => {
  it('系统 CPU >80% 连续 3 轮触发 alert，第 2 轮不触发', () => {
    const d = new IssueDetector();
    for (let i = 1; i <= 2; i++) {
      const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 85 });
      expect(issues.filter((x) => x.rule === 'system-cpu')).toHaveLength(0);
    }
    const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 85 });
    expect(issues.filter((x) => x.rule === 'system-cpu')).toHaveLength(1);
    expect(issues.find((x) => x.rule === 'system-cpu')!.severity).toBe('alert');
  });

  it('CPU 回落消除问题', () => {
    const d = new IssueDetector();
    for (let i = 0; i < 3; i++) d.update({ ...baseSnapshot(), cpuTotalPercent: 85 });
    const after = d.update({ ...baseSnapshot(), cpuTotalPercent: 30 });
    expect(after.filter((x) => x.rule === 'system-cpu')).toHaveLength(0);
  });

  it('单进程 cpuPercent>=100 连续 2 周期触发 locate-process 问题', () => {
    const d = new IssueDetector();
    const proc = { pid: 42, name: 'node.exe', cpuPercent: 120, workingSetBytes: 5e8 } as never as import('../electron/ipc-types').ProcessInfo;
    d.update({ ...baseSnapshot(), processes: [proc], procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }] } });
    const issues = d.update({ ...baseSnapshot(), processes: [proc], procHistory: { 42: [{ ts: 2, cpu: 120, mem: 5e8 }] } });
    const issue = issues.find((x) => x.rule === 'process-cpu');
    expect(issue).toBeTruthy();
    expect(issue!.processId).toBe(42);
    expect(issue!.action).toBe('locate-process');
  });

  it('内存 3 样本递增且增幅>15% 触发泄漏问题（复用 procHistory）', () => {
    const d = new IssueDetector();
    const hist = { 7: [{ ts: 1, cpu: 5, mem: 500e6 }, { ts: 2, cpu: 5, mem: 560e6 }, { ts: 3, cpu: 5, mem: 620e6 }] };
    const issues = d.update({ ...baseSnapshot(), processes: [{ pid: 7, name: 'a.exe', cpuPercent: 5, workingSetBytes: 620e6 } as never as import('../electron/ipc-types').ProcessInfo], procHistory: hist });
    const issue = issues.find((x) => x.rule === 'memory-growth');
    expect(issue).toBeTruthy();
    expect(issue!.processId).toBe(7);
  });

  it('磁盘剩余 <10% 触发 alert 问题', () => {
    const d = new IssueDetector();
    const issues = d.update({ ...baseSnapshot(), disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 8e10, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }] });
    expect(issues.find((x) => x.rule === 'disk-low')!.severity).toBe('alert');
  });

  it('同实体去重：连续轮次只返回一条；上限 10 条', () => {
    const d = new IssueDetector();
    const proc = { pid: 1, name: 'x.exe', cpuPercent: 150, workingSetBytes: 1e9 } as never as import('../electron/ipc-types').ProcessInfo;
    for (let i = 0; i < 4; i++) {
      const issues = d.update({ ...baseSnapshot(), cpuTotalPercent: 90, processes: [proc], procHistory: { 1: [{ ts: i, cpu: 150, mem: 1e9 }] }, disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 5e10, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }] });
      expect(issues.length).toBeLessThanOrEqual(10);
    }
    const last = d.update({ ...baseSnapshot(), cpuTotalPercent: 90 });
    expect(last.filter((x) => x.rule === 'process-cpu' || x.rule === 'disk-low')).toHaveLength(0); // proc 消失/磁盘恢复 → 消除
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/issueDetector.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（`app/src/lib/issueDetector.ts`）：

```ts
import type { PerfData, ProcessInfo } from '../../electron/ipc-types';

export type IssueRule = 'system-cpu' | 'process-cpu' | 'memory-growth' | 'disk-low';
export type IssueSeverity = 'attention' | 'alert';

export interface Issue {
  id: string;            // `${rule}:${entity}`（entity=pid 或盘名）
  rule: IssueRule;
  severity: IssueSeverity;
  title: string;
  detail: string;
  processId?: number;
  action: 'locate-process' | 'open-perf';
}

export interface IssueSnapshot {
  cpuTotalPercent: number;
  processes: ProcessInfo[];
  procHistory: Record<number, { ts: number; cpu: number; mem: number }[]>;
  disks: PerfData['disks'];
}

const MAX_ISSUES = 10;
const SEVERITY_RANK: Record<IssueSeverity, number> = { attention: 0, alert: 1 };

export class IssueDetector {
  private cpuHighStreak = 0;
  private active = new Map<string, Issue>(); // id -> issue（去重；消除时移除）

  update(snap: IssueSnapshot): Issue[] {
    const next = new Map<string, Issue>();

    // 系统 CPU 持续高：>80% 连续 3 轮
    this.cpuHighStreak = snap.cpuTotalPercent > 80 ? this.cpuHighStreak + 1 : 0;
    if (this.cpuHighStreak >= 3) {
      next.set('system-cpu:all', {
        id: 'system-cpu:all', rule: 'system-cpu', severity: 'alert',
        title: '系统 CPU 持续高占用', detail: `连续 ${this.cpuHighStreak} 个采样周期超过 80%`, action: 'open-perf',
      });
    }

    // 单进程 CPU 异常：>=100（占满一核）连续 2 轮
    for (const p of snap.processes) {
      if (p.cpuPercent >= 100) {
        const prev = this.active.get(`process-cpu:${p.pid}`);
        if (prev) { // 上一轮已在 → 连续第 2 轮
          next.set(`process-cpu:${p.pid}`, {
            id: `process-cpu:${p.pid}`, rule: 'process-cpu', severity: 'attention',
            title: `${p.name} 持续高占用 CPU`, detail: `CPU ${Math.round(p.cpuPercent)}%（占满 ${(p.cpuPercent / 100).toFixed(1)} 核）`,
            processId: p.pid, action: 'locate-process',
          });
        } else {
          // 第 1 轮：记入 active 供下轮判定（不产生问题）
          this.active.set(`process-cpu:${p.pid}`, { id: `process-cpu:${p.pid}`, rule: 'process-cpu', severity: 'attention', title: '', detail: '', processId: p.pid, action: 'locate-process' });
        }
      }
    }

    // 内存增长：procHistory 末 3 样本递增且增幅 >15% 或 >200MB
    for (const [pidStr, points] of Object.entries(snap.procHistory)) {
      const pid = Number(pidStr);
      if (points.length < 3) continue;
      const last3 = points.slice(-3);
      const [a, b, c] = last3.map((x) => x.mem);
      const growth = (c - a) / (a || 1);
      if (a < b && b < c && (growth > 0.15 || c - a > 200 * 1024 * 1024)) {
        const proc = snap.processes.find((x) => x.pid === pid);
        next.set(`memory-growth:${pid}`, {
          id: `memory-growth:${pid}`, rule: 'memory-growth', severity: 'attention',
          title: `${proc?.name ?? `PID ${pid}`} 内存持续增长`, detail: `近 3 个采样周期增长 ${Math.round(growth * 100)}%（疑似泄漏）`,
          processId: pid, action: 'locate-process',
        });
      }
    }

    // 磁盘低：任一盘剩余 <10%
    for (const d of snap.disks) {
      if (d.totalBytes > 0 && d.freeBytes / d.totalBytes < 0.1) {
        const pct = Math.round((d.freeBytes / d.totalBytes) * 100);
        next.set(`disk-low:${d.name}`, {
          id: `disk-low:${d.name}`, rule: 'disk-low', severity: 'alert',
          title: `${d.name} 磁盘空间不足`, detail: `剩余 ${pct}%`, action: 'open-perf',
        });
      }
    }

    this.active = next;
    return [...next.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, MAX_ISSUES);
  }
}
```

注意：单进程 CPU 第 1 轮的「占位记录」也写入 this.active（供消除判断——进程消失/回落时自然消失）。

- [ ] **Step 4: 运行确认通过**：`npx vitest run tests/issueDetector.test.ts && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/lib/issueDetector.ts app/tests/issueDetector.test.ts
git commit -m "feat(app): issue detector with streak dedupe rules"
```

---

### Task 3: homeStore + useHome hook

**Files:**
- Create: `app/src/store/homeStore.ts`
- Create: `app/src/hooks/useHome.ts`
- Test: `app/tests/useHome.test.tsx`

- [ ] **Step 1: 写失败测试**（`app/tests/useHome.test.tsx`——renderHook 驱动，模拟 store 数据）：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHomeStore } from '../src/store/homeStore';
import { useHome } from '../src/hooks/useHome';
import { usePerfStore } from '../src/store/perfStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => { __resetToastStoreForTests(); useHomeStore.getState().reset(); usePerfStore.getState().reset(); useProcessPanelStore.getState().reset(); });

describe('useHome', () => {
  it('从 perf/process store 计算评估与问题（2s 轮询）', () => {
    vi.useFakeTimers();
    usePerfStore.getState().setPerf({
      cpu: { totalPercent: 88, perCore: [88] },
      memory: { totalBytes: 1e10, availableBytes: 2e9, usedPercent: 80 },
      disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 2e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
      networks: [], gpu: { engines: [], percent: null, dedicatedBytes: 0, sharedBytes: 0, dedicatedUsedBytes: 0 },
    });
    useProcessPanelStore.getState().setProcesses({ processes: [], error: null, staleAt: null } as never);
    renderHook(() => useHome());
    act(() => { vi.advanceTimersByTime(2100); });
    const s = useHomeStore.getState();
    expect(s.assessment.level).toBe('good'); // 内存 80 → attention → good
    expect(s.issues.length).toBeGreaterThan(0); // CPU 88 第 1 轮不触发，但首轮后有数据
    vi.useRealTimers();
  });

  it('卸载停止轮询', () => {
    const { unmount } = renderHook(() => useHome());
    unmount();
    expect(useHomeStore.getState().running).toBe(false);
  });
});
```

（`setProcesses` 真实签名以 processPanelStore 为准——Read 确认后适配；若签名复杂可改为直接 `useProcessPanelStore.setState({...})`。）

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/useHome.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 homeStore**（`app/src/store/homeStore.ts`，非持久化，仅存计算结果）：

```ts
import { create } from 'zustand';
import { assessHealth, type HealthAssessment, type HealthInput } from '../lib/healthAssess';
import { IssueDetector, type Issue } from '../lib/issueDetector';

interface HomeState {
  assessment: HealthAssessment | null;
  issues: Issue[];
  detector: IssueDetector; // 实例跨轮次保持 streak/去重状态
  running: boolean;
  refresh: () => void;
  setRunning: (b: boolean) => void;
  reset: () => void;
}

export const useHomeStore = create<HomeState>((set, get) => ({
  assessment: null,
  issues: [],
  detector: new IssueDetector(),
  running: false,
  refresh: () => {
    // 从既有 store 读快照（每轮 tick 调用；数据由 usePerf/useProcessPanel 的轮询写入）
    const perf = usePerfStoreRef.getState().current;
    const ps = useProcessPanelStoreRef.getState();
    if (!perf) return;
    const diskFreeMin = perf.disks.filter((d) => d.totalBytes > 0)
      .reduce((min, d) => Math.min(min, d.freeBytes / d.totalBytes * 100), 100);
    const issues = get().detector.update({
      cpuTotalPercent: perf.cpu.totalPercent,
      processes: ps.processes,
      procHistory: ps.procHistory,
      disks: perf.disks,
    });
    const assessment = assessHealth({
      cpuPercent: perf.cpu.totalPercent,
      memPercent: perf.memory.usedPercent,
      diskFreeMinPercent: diskFreeMin,
      gpuPercent: perf.gpu.percent,
      issueCount: issues.length,
    });
    set({ assessment, issues });
  },
  setRunning: (b) => set({ running: b }),
  reset: () => set({ assessment: null, issues: [], running: false, detector: new IssueDetector() }),
}));

// 延迟引用避免循环 import（homeStore 不 import store 类型定义，运行时 getState 即可）
import { usePerfStore as usePerfStoreRef } from './perfStore';
import { useProcessPanelStore as useProcessPanelStoreRef } from './processPanelStore';
```

注意：import 放文件尾部的写法不标准——**正常写法**：文件顶部 `import { usePerfStore } from './perfStore'; import { useProcessPanelStore } from './processPanelStore';` 并在 refresh 内 `usePerfStore.getState()`（无循环依赖：perfStore/processPanelStore 不 import homeStore）。实现时按标准顶部 import 写。

- [ ] **Step 4: 实现 useHome**（`app/src/hooks/useHome.ts`，2s 轮询，busyRef/stoppedRef 模式照 usePerf/useProcessPanel 既有范式）：

```ts
import { useEffect } from 'react';
import { useHomeStore } from '../store/homeStore';

const TICK_MS = 2000;

export function useHome() {
  const running = useHomeStore((s) => s.running);
  const setRunning = useHomeStore((s) => s.setRunning);

  useEffect(() => {
    if (running) return;
    setRunning(true);
    const id = setInterval(() => useHomeStore.getState().refresh(), TICK_MS);
    useHomeStore.getState().refresh(); // 首帧立即计算
    return () => { clearInterval(id); useHomeStore.getState().setRunning(false); };
  }, [running, setRunning]);
}
```

（若与既有 hook 的可见性订阅模式冲突，照 `usePerf.ts` 的 visibility/暂停模式对齐——Read usePerf.ts 后按同范式实现。）

- [ ] **Step 5: 运行确认通过**：`npx vitest run tests/useHome.test.tsx && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 6: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/store/homeStore.ts app/src/hooks/useHome.ts app/tests/useHome.test.tsx
git commit -m "feat(app): home store with 2s assessment tick"
```

---

### Task 4: HomePanel 组件（四区仪表盘）

**Files:**
- Create: `app/src/components/HomePanel.tsx`
- Test: `app/tests/HomePanel.test.tsx`

- [ ] **Step 1: 写渲染测试**（`app/tests/HomePanel.test.tsx`——直接向 homeStore 灌数据后渲染，挂 ToastHost）：

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomePanel } from '../src/components/HomePanel';
import { ToastHost } from '../src/components/ToastHost';
import { useHomeStore } from '../src/store/homeStore';
import { __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => { __resetToastStoreForTests(); useHomeStore.getState().reset(); });

const seed = () => useHomeStore.setState({
  assessment: { level: 'attention', reasons: ['内存使用率 82%'] },
  issues: [{
    id: 'process-cpu:42', rule: 'process-cpu', severity: 'attention',
    title: 'node.exe 持续高占用 CPU', detail: 'CPU 120%（占满 1.2 核）', processId: 42, action: 'locate-process',
  }],
});

describe('HomePanel', () => {
  it('渲染状态评估横幅（level + reasons）', () => {
    seed();
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText(/需要关注/)).toBeInTheDocument();
    expect(screen.getByText(/内存使用率 82%/)).toBeInTheDocument();
  });

  it('渲染问题清单与处理按钮', () => {
    seed();
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText(/node\.exe 持续高占用 CPU/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /处理/ })).toBeInTheDocument();
  });

  it('无问题时空态', () => {
    useHomeStore.setState({ assessment: { level: 'excellent', reasons: [] }, issues: [] });
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText(/暂无异常/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/HomePanel.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 HomePanel**（`app/src/components/HomePanel.tsx`）：

结构（照 spec §3.1 四区）：
- 顶部 `PanelActionBar`（label「首页」，summary=评估分级或「数据采集中」）
- ① 状态评估横幅：level → 文案映射（excellent=优/good=良好/attention=需要关注/alert=需要处理），reasons 拼接；色：excellent/good=success 或 content、attention=warn、alert=danger（用 Badge 或 PanelAlert 语义）
- ② 状态卡（5 张：CPU/内存/磁盘/网络/GPU）：从 perfStore.current 取数（usePerfStore selector）；网络=networks 汇总 recv+send；磁盘=disks 最小剩余；GPU=perf.gpu.percent（null 时显示「—」）；卡状态色同评估规则；`useContainerWidth`（既有 hook）≥960px 5 卡一行，否则 2 卡换行
- ③ 问题清单：issues 按 severity 排序渲染（title + detail + Badge 严重度 + 「处理」按钮）；空态「暂无异常」；处理动作：issue.action==='locate-process' → `useLayoutStore.getState().openPanel('process')` + `useProcessPanelStore.getState().selectAll([pid])`（联动机制，Read App.tsx 的 openPanel 用法确认签名——可能是 hook 包装，用 `useLayoutStore.getState().openPanel('process')`）；open-perf → openPanel('perf')
- ④ 快速动作：3 个 Button（查看高占用进程 → openPanel('process')+selectAll(cpu 排行前 3 pid)；结束异常进程 → 同上选中 issue 进程；打开性能详情 → openPanel('perf')）
- 空数据（perfStore.current===null）：StateView loading

- [ ] **Step 4: 运行确认通过**：`npx vitest run tests/HomePanel.test.tsx && pnpm typecheck`
Expected: 全 PASS（首帧 assessment null → 渲染 StateView loading；seed 后渲染四区）

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/HomePanel.tsx app/tests/HomePanel.test.tsx
git commit -m "feat(app): steward home panel with assessment, cards, issues, actions"
```

---

### Task 5: 导航接入（panelCatalog + 预设 + App 映射）

**Files:**
- Modify: `app/src/components/workspace/panelCatalog.tsx`
- Modify: `app/src/store/layoutStore.ts:150-152`
- Modify: `app/src/App.tsx`（PANELS 映射）
- Modify: `app/tests/workspaceNavigation.test.tsx`
- Modify: `app/tests/panelCatalog.test.tsx`（如有 7 面板计数断言）
- Modify: `app/tests/layoutStore.test.ts`（如有 classic 预设断言）

- [ ] **Step 1: panelCatalog 加 home**：

```tsx
  home: {
    title: '首页',
    group: 'monitoring',
    icon: <House aria-hidden="true" />,
  },
```
- `House` 从 lucide 经 `icons.tsx` facade 导出（Read `app/src/components/icons.tsx` 确认导出名；若无 House 用 `Home`——以 facade 实际导出为准，两个都是 lucide 图标）
- **位置**：`BUILTIN_PANEL_DEFINITIONS` 数组按 panelCatalog 内对象键序排列——把 `home` 条目放在 `port` 之前（监控组第一）
- **startup 条目**：`group: 'workflow'` → `'monitoring'`（spec §6：启动项归入监控组）

- [ ] **Step 2: layoutStore classic 预设**：`classic: 'process'` → `classic: 'home'`（注释同步：「单面板首页占满 —— 电脑管家首屏」）

- [ ] **Step 3: App.tsx PANELS 映射**：找到 `PANELS`（panelId → 组件）映射，加 `home: HomePanel`，并 import HomePanel。同时确认 App 首屏逻辑（零状态 → applyPreset('classic') 已存在——classic 变 home 后首启即首页；无需额外改动）

- [ ] **Step 4: 更新测试**：
- `workspaceNavigation.test.tsx`：monitoring 组断言改为 `['首页', '性能', '进程', '端口雷达', '启动项']`；workflow 组断言改为 `['快照', 'AI 会话', '运行配置']`
- `panelCatalog.test.tsx`：如断言「7 个内置面板」改为 8；group 分布断言同步
- `layoutStore.test.ts`：如断言 classic 预设根节点 === 'process' 改为 'home'

- [ ] **Step 5: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/workspaceNavigation.test.tsx tests/panelCatalog.test.tsx tests/layoutStore.test.ts tests/HomePanel.test.tsx`
Expected: 全 PASS

- [ ] **Step 6: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/workspace/panelCatalog.tsx app/src/store/layoutStore.ts app/src/App.tsx app/tests/workspaceNavigation.test.tsx app/tests/panelCatalog.test.tsx app/tests/layoutStore.test.ts
git commit -m "feat(app): wire home panel as default first screen (monitoring group)"
```

---

### Task 6: 全量验证 + 文档收尾

- [ ] **Step 1: 全量测试 + typecheck**：

```bash
cd "E:\A_Project\codemgr/app" && pnpm vitest run 2>&1 | tail -3 && pnpm typecheck
```
Expected: 全 PASS（593 + 新增约 15-20 条）、typecheck 干净

- [ ] **Step 2: native 确认未动**：`git diff main..HEAD --stat -- codemgr-native/` → 空（无 native 改动，无需 build:electron；但最终 `pnpm build` 验证渲染产物可过）

- [ ] **Step 3: 文档**：
- `CHANGELOG.md` `[Unreleased]` 节新增（若无则建节）：

```markdown
## [Unreleased]

### 电脑管家首页（Steward Home，2026-08-01）
- 新增「首页」面板（默认首屏）：电脑状态评估横幅（优/良好/需要关注/需要处理，透明规则 + 判定依据文案）+ CPU/内存/磁盘/网络/GPU 五状态卡 + 检测引擎问题清单（系统 CPU 持续高/单进程 CPU 异常/内存增长疑似泄漏/磁盘空间低，去重 + 上限 10）+ 快速动作（查看高占用/结束异常进程/打开详情）。
- 问题项与快速动作可一键定位到进程面板并选中目标进程（联动复用既有 openPanel + selectAll 机制）。
- 信息架构：监控组重排为 首页/性能/进程/端口雷达/启动项（启动项由工作流组移入）；classic 布局预设根节点改为首页。
- 评估模型 `lib/healthAssess`（最差指标主导 + 问题数修正）与检测引擎 `lib/issueDetector`（有状态规则引擎）均为纯 TS，复用既有轮询数据，零 native/IPC 改动。
```

- `AGENTS.md` §8：v2.4 条目后新增一行 `- **v2.4.1**（未发版）：电脑管家首页（见 CHANGELOG）。` 或并入 v2.4 描述末尾；测试数更新（跑完 Step 1 拿实数，格式 `app X/X + native 51/51，共 Y PASS`）

- [ ] **Step 4: 提交**

```bash
cd "E:\A_Project\codemgr" && git add CHANGELOG.md AGENTS.md
git commit -m "docs: record steward home iteration"
```

- [ ] **Step 5: 人工验收清单交付**（最终报告逐项确认 spec §10）：

- [ ] 启动默认打开首页（横幅 + 5 卡 + 问题清单 + 快速动作）
- [ ] 评估分级与 reasons 与规则表一致（测试覆盖）
- [ ] 模拟高 CPU 3 轮触发问题、回落消除（测试覆盖）
- [ ] 问题项处理 → 进程面板选中对应 pid
- [ ] 磁盘卡显示真实剩余
- [ ] 监控组顺序 首页/性能/进程/端口雷达/启动项；工作流组 = 快照/AI 会话/运行配置
- [ ] app 全量通过 + typecheck 干净 + native 51 不变

---

## Self-Review 记录

- **Spec 覆盖**：§3.2 评估模型（T1）✓；§3.4 检测引擎（T2）✓；§4 数据流/§3.3 卡片（T3+T4）✓；§3.5 快速动作/§7 联动（T4）✓；§6 导航（T5）✓；§8 测试（T1-T5 内嵌）✓；§10 验收（T6）✓。
- **Spec 偏差（有意，实施前已修订 spec 本体）**：① §5 磁盘数据免新增 IPC（perf.disks 已有 freeBytes）——spec 已 amend；② 单进程 CPU 异常阈值 30% → `cpuPercent >= 100`（字段语义为相对单核）——spec 已 amend。
- **占位符**：T3/T4 中两处「Read 既有实现后按同范式」为对齐既有模式的指引（usePerf 轮询范式、icons facade 导出名、openPanel 用法），非空泛占位——实现者必须先 Read 再写。
- **类型一致性**：`Issue`/`IssueSnapshot`/`HealthInput` 在 T1-T4 中一致使用；`PerfData.disks` 元素形状在 T2 测试与实现中一致（name/totalBytes/freeBytes/readBytesPerSec/writeBytesPerSec/activePercent）。
