# 项目分组视图排序与虚拟滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分组视图补齐与树形视图对等的列排序（组级 name/memory + 组内 name/cpu/memory/pid）和 >100 行虚拟滚动。

**Architecture:** 纯逻辑 `lib/groupSort.ts`（TDD）+ ProjectGroupView 改造（sort state + 可点表头 + 行扁平化 + react-virtual spacer 窗口化，照 ProcessTable 既有方案）。

**Tech Stack:** @tanstack/react-virtual、zustand（既有 expandedGroups）、Vitest。

**Spec:** `docs/superpowers/specs/2026-07-31-group-view-sort-virtual-design.md`

---

### Task 1: groupSort 纯逻辑（TDD）

**Files:**
- Create: `app/src/lib/groupSort.ts`
- Test: `app/tests/groupSort.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { sortGroups, sortGroupProcs } from '../src/lib/groupSort';
import type { ProjectGroup } from '../src/lib/projectGroup';
import type { ProcessInfo } from '../electron/ipc-types';

const mkProc = (pid: number, name: string, mem: number): ProcessInfo => ({
  pid, ppid: 1, name, cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: mem, createTimeMs: 0, threadCount: 1, handleCount: 1,
});
const groups: ProjectGroup[] = [
  { name: 'beta', dir: 'D:\\b', pids: [1], totalMemory: 100 },
  { name: 'alpha', dir: 'D:\\a', pids: [2, 3], totalMemory: 300 },
  { name: 'gamma', dir: null, pids: [4], totalMemory: 200 },
];

describe('sortGroups', () => {
  it('按名称 asc/desc', () => {
    expect(sortGroups(groups, 'name', 'asc').map((g) => g.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortGroups(groups, 'name', 'desc').map((g) => g.name)).toEqual(['gamma', 'beta', 'alpha']);
  });
  it('按合计内存 desc；cpu/pid 保持原序', () => {
    expect(sortGroups(groups, 'memory', 'desc').map((g) => g.totalMemory)).toEqual([300, 200, 100]);
    expect(sortGroups(groups, 'cpu', 'desc').map((g) => g.name)).toEqual(['beta', 'alpha', 'gamma']);
    expect(sortGroups(groups, 'pid', 'asc').map((g) => g.name)).toEqual(['beta', 'alpha', 'gamma']);
  });
  it('同值稳定（保持原相对序）', () => {
    const same: ProjectGroup[] = [
      { name: 'b', dir: null, pids: [], totalMemory: 1 },
      { name: 'a', dir: null, pids: [], totalMemory: 1 },
    ];
    expect(sortGroups(same, 'memory', 'asc').map((g) => g.name)).toEqual(['b', 'a']);
  });
});

describe('sortGroupProcs', () => {
  const procs = [mkProc(3, 'c.exe', 300), mkProc(1, 'a.exe', 100), mkProc(2, 'b.exe', 200)];
  const cpu = { 1: 50, 2: 10, 3: 90 };
  it('四键排序', () => {
    expect(sortGroupProcs(procs, 'name', 'asc', cpu).map((p) => p.name)).toEqual(['a.exe', 'b.exe', 'c.exe']);
    expect(sortGroupProcs(procs, 'cpu', 'desc', cpu).map((p) => p.pid)).toEqual([3, 1, 2]);
    expect(sortGroupProcs(procs, 'memory', 'asc', cpu).map((p) => p.workingSetBytes)).toEqual([100, 200, 300]);
    expect(sortGroupProcs(procs, 'pid', 'asc', cpu).map((p) => p.pid)).toEqual([1, 2, 3]);
  });
  it('cpu 缺失按 0 处理', () => {
    expect(sortGroupProcs([mkProc(9, 'z.exe', 1)], 'cpu', 'desc', {}).map((p) => p.pid)).toEqual([9]);
  });
});
```

（`ProjectGroup` 字段以 `app/src/lib/projectGroup.ts` 实际导出为准：若字段名不同（如 `memoryBytes`），按实际调整。）

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// 分组视图排序（子项目 H3，纯逻辑）：组级 name/memory；组内 name/cpu/memory/pid。稳定排序。
import type { ProjectGroup } from './projectGroup';
import type { ProcessInfo } from '../../electron/ipc-types';

export type GroupSortKey = 'name' | 'cpu' | 'memory' | 'pid';
export type SortDir = 'asc' | 'desc';

function byDir<T>(dir: SortDir, cmp: (a: T, b: T) => number) {
  return (a: T, b: T) => (dir === 'asc' ? cmp(a, b) : -cmp(a, b));
}

/** 组级排序：cpu/pid 对组无意义 → 原序返回。 */
export function sortGroups(groups: ProjectGroup[], key: GroupSortKey, dir: SortDir): ProjectGroup[] {
  if (key === 'name') return [...groups].sort(byDir(dir, (a, b) => a.name.localeCompare(b.name)));
  if (key === 'memory') return [...groups].sort(byDir(dir, (a, b) => a.totalMemory - b.totalMemory));
  return groups;
}

export function sortGroupProcs(
  procs: ProcessInfo[], key: GroupSortKey, dir: SortDir, cpuMap: Record<number, number>,
): ProcessInfo[] {
  const cmp = {
    name: (a: ProcessInfo, b: ProcessInfo) => a.name.localeCompare(b.name),
    cpu: (a: ProcessInfo, b: ProcessInfo) => (cpuMap[a.pid] ?? 0) - (cpuMap[b.pid] ?? 0),
    memory: (a: ProcessInfo, b: ProcessInfo) => a.workingSetBytes - b.workingSetBytes,
    pid: (a: ProcessInfo, b: ProcessInfo) => a.pid - b.pid,
  }[key];
  return [...procs].sort(byDir(dir, cmp));
}
```

- [ ] **Step 4: PASS + Commit**

```bash
git add app/src/lib/groupSort.ts app/tests/groupSort.test.ts
git commit -m "feat(app): group view sort logic (group name/memory, proc name/cpu/memory/pid)"
```

---

### Task 2: ProjectGroupView 排序表头 + 虚拟滚动

**Files:**
- Modify: `app/src/components/ProjectGroupView.tsx`
- Test: `app/tests/projectGroupViewVirtual.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ProjectGroupView } from '../src/components/ProjectGroupView';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

vi.mock('../src/lib/ipc', () => ({
  ipc: {
    openTarget: vi.fn(async () => ''),
    openExternalUrl: vi.fn(async () => ''),
    fetchCwd: vi.fn(async () => null),
  },
}));

const mkProc = (pid: number, cwd: string): ProcessInfo => ({
  pid, ppid: 1, name: `p${pid}.exe`, cmdline: '', cwd, kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 1024, createTimeMs: 0, threadCount: 1, handleCount: 1,
});

function seed(processes: ProcessInfo[], expanded: string[]) {
  useProcessPanelStore.setState({
    processes, cpuMap: {}, filter: '',
    expandedGroups: new Set(expanded),
  } as never);
}

describe('ProjectGroupView virtualization', () => {
  it('总行数 ≤100 全部渲染（无 spacer）', () => {
    seed([mkProc(1, 'D:\\a'), mkProc(2, 'D:\\a'), mkProc(3, 'D:\\b')], ['a', 'b']);
    const { container } = render(<ProjectGroupView onKillSingle={vi.fn()} onKillGroup={vi.fn()} onKillTree={vi.fn()} />);
    expect(container.querySelectorAll('[data-virtual-spacer]')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(5);
  });

  it('总行数 >100 窗口化渲染（行数小于全量）', () => {
    const procs = Array.from({ length: 300 }, (_, i) => mkProc(i + 1, 'D:\\big'));
    seed(procs, ['big']);
    const { container } = render(<ProjectGroupView onKillSingle={vi.fn()} onKillGroup={vi.fn()} onKillTree={vi.fn()} />);
    const rendered = container.querySelectorAll('tbody tr').length;
    expect(rendered).toBeLessThan(200); // 窗口 + spacer，远小于 301
    expect(container.querySelectorAll('[data-virtual-spacer]').length).toBeGreaterThan(0);
  });
});
```

（seed 的 expandedGroups 键以 groupByProject 产出的组 identity 为准——组名为 cwd 末段名（如 'big'）；若实际不同按 projectGroup.ts 调整。测试同时固定 jsdom 无 scrollIntoView 防御既有模式。）

- [ ] **Step 2: 确认失败 → Step 3: 改造 ProjectGroupView**

要点（完整重写组件主体，保留既有精确 cwd 拉取 effect 与右键菜单逻辑）：

```tsx
// 新增 import
import { useVirtualizer } from '@tanstack/react-virtual';
import { sortGroups, sortGroupProcs, type GroupSortKey, type SortDir } from '../lib/groupSort';

// 组件内新增
const [sort, setSort] = useState<{ key: GroupSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
function toggleSort(key: GroupSortKey) {
  setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
}

// 应用链：filtered → groupByProject → sortGroups
const sortedGroups = useMemo(() => sortGroups(groups, sort.key, sort.dir), [groups, sort]);

// 扁平化行（仅展开组贡献 proc 行；组内 procs 排序）
type FlatRow =
  | { type: 'group'; key: string; g: (typeof sortedGroups)[number]; procs: ProcessInfo[] }
  | { type: 'proc'; key: string; proc: ProcessInfo };
const flatRows = useMemo<FlatRow[]>(() => {
  const out: FlatRow[] = [];
  for (const g of sortedGroups) {
    const groupKey = g.dir ?? g.name;
    const procs = g.pids.map((pid) => procByPid.get(pid)).filter((x): x is ProcessInfo => !!x);
    out.push({ type: 'group', key: `g:${groupKey}`, g, procs: sortGroupProcs(procs, sort.key, sort.dir, cpuMap) });
    if (expandedGroups.has(groupKey)) {
      for (const p of sortGroupProcs(procs, sort.key, sort.dir, cpuMap)) {
        out.push({ type: 'proc', key: `p:${groupKey}:${p.pid}`, proc: p });
      }
    }
  }
  return out;
}, [sortedGroups, procByPid, expandedGroups, sort, cpuMap]);

// 虚拟化（>100 行启用，spacer 方案照 ProcessTable）
const scrollRef = useRef<HTMLDivElement>(null);
const shouldVirtualize = flatRows.length > 100;
const virtualizer = useVirtualizer({
  count: shouldVirtualize ? flatRows.length : 0,
  getScrollElement: () => scrollRef.current,
  estimateSize: (i) => (flatRows[i]?.type === 'group' ? 37 : 29),
  overscan: 10,
});
const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
const padTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
const padBottom = shouldVirtualize && virtualItems.length > 0
  ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end : 0;
const visibleRows = shouldVirtualize
  ? virtualItems.map((vi) => flatRows[vi.index]!)
  : flatRows;
```

渲染：最外层 div 改 `ref={scrollRef}`；tbody 结构：

```tsx
<tbody>
  {padTop > 0 && <tr data-virtual-spacer="top" aria-hidden="true"><td colSpan={8} style={{ height: padTop, padding: 0, border: 'none' }} /></tr>}
  {visibleRows.map((row) => row.type === 'group'
    ? <GroupHeaderRow key={row.key} ... onToggle={() => onToggle(row.g.dir ?? row.g.name)} ... />
    : <GroupProcRow key={row.key} proc={row.proc} cpu={cpuMap[row.proc.pid] || 0} onKillSingle={onKillSingle} onContextMenuRow={onContextMenuRow} />)}
  {padBottom > 0 && <tr data-virtual-spacer="bottom" aria-hidden="true"><td colSpan={8} style={{ height: padBottom, padding: 0, border: 'none' }} /></tr>}
  {flatRows.length === 0 && (<tr><td colSpan={8} className="px-2 py-8 text-center text-fg-muted">无进程</td></tr>)}
</tbody>
```

`GroupHeaderRow`/`GroupProcRow` 从原 GroupRow 拆出（GroupHeaderRow 含组名/计数/合计内存/dir/三个打开按钮/结束本组；GroupProcRow 含标签/cpu/内存/pid/线程/命令行/结束按钮 + onContextMenu）。

表头四个可点列（照 ProcessTable 表头模式）：

```tsx
const SORTABLE: [GroupSortKey, string, string][] = [
  ['name', '项目 / 名称', 'px-2 py-2 font-medium'],
  ['cpu', 'CPU%', 'w-16 px-2 py-2 font-medium text-right'],
  ['memory', '内存/MB', 'w-20 px-2 py-2 font-medium text-right'],
  ['pid', 'PID', 'w-16 px-2 py-2 font-medium text-right'],
];
// <th> 内包 <button onClick={() => toggleSort(key)}> {label}{sort.key===key ? (sort.dir==='asc'?' ▲':' ▼') : ''} </button>
```

- [ ] **Step 4: PASS + 全量回归 + CHANGELOG + Commit**

CHANGELOG `[Unreleased]` 追加：

```markdown
- **项目分组视图对齐树形视图能力**：组级按项目名/合计内存排序、组内进程按名称/CPU%/内存/PID 排序（点击表头切换）；总行数 >100 启用虚拟滚动（组头与进程行混合窗口化）。
```

```bash
git add app/src/components/ProjectGroupView.tsx app/tests/projectGroupViewVirtual.test.tsx CHANGELOG.md
git commit -m "feat(app): project group view column sorting + virtualization over 100 rows"
```

---

## Self-Review 记录

- Spec §3.1 → Task 1；§3.2 → Task 2；§4 测试 → Task 1/2。
- 类型一致性：`GroupSortKey/SortDir` Task 1 定义，Task 2 复用；`FlatRow` 仅 Task 2 内部。`ProjectGroup` 字段（name/dir/pids/totalMemory）以 projectGroup.ts 为准（Task 1 已注明核对）。
- 风险：组 identity 键（dir ?? name）在排序后展开态仍按 store expandedGroups 键匹配——键不随排序变化，安全；测试 seed 的组名假设（cwd 末段）以 projectGroup.ts 实际逻辑为准。
