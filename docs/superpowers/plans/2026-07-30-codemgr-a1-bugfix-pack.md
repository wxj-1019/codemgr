# CodeMgr A1 — 纯前端 Bug 修复包 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 4 个已存在行为错误的纯前端 bug，让进程排序、全选、项目分组、快照对比的行为可信——为后续跨面板联动打基础。

**Architecture:** 全部改动在 `app/src/` 与 `app/tests/` 内。零 native / main / preload / IPC 接口变更。每个 bug 走 TDD（先写/改测试看红，再改实现看绿），一个 bug 一个 commit。默认状态零回归。

**Tech Stack:** React 18 + TypeScript + Zustand + Vitest（jsdom + @testing-library/react）。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-a1-bugfix-pack.md`

**分支:** 已在 `docs/a1-bugfix-spec`（本 spec 文档提交）。实现沿用此分支。

---

## 文件结构

每个 bug 影响的文件（修改 / 测试）。无新建模块——全部是对既有文件的定点修复。

| Bug | 修改文件 | 测试文件 |
|-----|---------|---------|
| #1 排序 | `app/src/components/ProcessTable.tsx` | `app/tests/processTableSort.test.tsx`（新建） |
| #2 全选 | `app/src/components/ProcessTable.tsx` | `app/tests/processTableSelect.test.tsx`（新建） |
| #3 worktree key | `app/src/lib/projectGroup.ts`、`app/src/components/ProjectGroupView.tsx`、`app/src/store/processPanelStore.ts` | `app/tests/projectGroup.test.ts`（扩展） |
| #5 快照 changed | `app/src/lib/snapshotDiff.ts` | `app/tests/snapshotDiff.test.ts`（改写固化测试 + 新增） |

---

## Task 1: Bug #5 — 快照 changed 移除 workingSetBytes 比较

> 最独立的 bug（纯函数），先做。它改写一个固化错误行为的测试，确认 TDD 红绿循环在此项目可正常运转。

**Files:**
- Modify: `app/src/lib/snapshotDiff.ts:39-50`
- Test: `app/tests/snapshotDiff.test.ts:96-102`

- [ ] **Step 1: 改写固化测试（先让它变红）**

打开 `app/tests/snapshotDiff.test.ts`，找到这个用例（约 :96）：

```ts
  it('workingSetBytes change alone counts as changed', () => {
    const base = [entry({ pid: 1, workingSetBytes: 100 })];
    const cur = [entry({ pid: 1, workingSetBytes: 200 })];
    const d = diffSnapshots(base, cur);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].after.workingSetBytes).toBe(200);
  });
```

替换为（翻转断言 + 新增混合用例）：

```ts
  it('workingSetBytes change alone does NOT count as changed', () => {
    // 内存抖动是常态，不应算进程身份/配置变化（spec bug #5）
    const base = [entry({ pid: 1, workingSetBytes: 100 })];
    const cur = [entry({ pid: 1, workingSetBytes: 200 })];
    const d = diffSnapshots(base, cur);
    expect(d.changed).toHaveLength(0);
  });

  it('structural change + workingSet change still counts as changed', () => {
    // 结构字段（name/cmdline/cwd）变化仍进 changed，内存移出不影响其捕获
    const base = [entry({ pid: 1, cmdline: 'node a.js', workingSetBytes: 100 })];
    const cur = [entry({ pid: 1, cmdline: 'node b.js', workingSetBytes: 200 })];
    const d = diffSnapshots(base, cur);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].after.cmdline).toBe('node b.js');
  });
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/snapshotDiff.test.ts`
Expected: FAIL —— "workingSetBytes change alone does NOT count as changed" 断言 `toHaveLength(0)` 失败（当前实现返回 1 个 changed）。

- [ ] **Step 3: 修改实现**

打开 `app/src/lib/snapshotDiff.ts`，将 `entryChanged`（:43-50）改为：

```ts
/**
 * 判断两条 identity 相同的条目是否「有变化」。只比较结构字段 name/cmdline/cwd。
 * 注意 createTimeMs 已用于 identity 匹配，此处不再比较。
 *
 * workingSetBytes 不纳入 changed 判定（bug #5 修复）：内存抖动是存活进程的
 * 常态，纳入会让快照「有变化」列表被内存波动淹没，淹没真正的结构变化。
 * 进程重 exec（node→deno）会同时改 name/cmdline，仍能被捕获；
 * 内存泄漏/资源异常检测属于「资源异常」范畴，留给后续 AI Session 资源聚合，
 * 不塞进快照身份 diff。
 */
function entryChanged(before: SnapshotEntry, after: SnapshotEntry): boolean {
  return (
    before.name !== after.name ||
    before.cmdline !== after.cmdline ||
    before.cwd !== after.cwd
  );
}
```

同步更新文件顶部注释（约 :13-17）中关于 changed 判定字段的描述：把 "name / cmdline / cwd / workingSetBytes" 改为 "name / cmdline / cwd"，并删除"workingSetBytes 变化几乎必然，但仍纳入 changed"那句矛盾的说明。

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/snapshotDiff.test.ts`
Expected: PASS —— 全部 15（原 15 减 1 加 2 = 16）用例通过。

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/snapshotDiff.ts app/tests/snapshotDiff.test.ts
git commit -m "fix(app): snapshot changed ignores workingSetBytes noise

workingSetBytes fluctuates on every poll for live processes, flooding the
snapshot 'changed' list and burying real structural changes. entryChanged now
compares only name/cmdline/cwd. Process re-exec (node->deno) still changes
name/cmdline and is still detected. Memory-leak detection belongs to resource
anomaly tracking, not snapshot identity diff."
```

---

## Task 2: Bug #3 — 同名 worktree 显示名消歧（纯函数层）

> 分两步：先改纯函数 `projectGroup.ts`（加消歧 + TDD），再改 UI/store 的 identity 键。本 Task 只做纯函数。

**Files:**
- Modify: `app/src/lib/projectGroup.ts`
- Test: `app/tests/projectGroup.test.ts`

- [ ] **Step 1: 写失败测试（消歧 + identity 唯一性）**

在 `app/tests/projectGroup.test.ts` 末尾（最后一个 `it` 之后，`describe` 闭合 `});` 之前）追加：

```ts
  // ── bug #3：同名 worktree 显示名消歧 + identity 键唯一 ──

  it('disambiguates same-basename groups by parent segment', () => {
    // 两个不同完整路径、相同 basename（app）→ 两组，name 加父段消歧
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\worktrees\\x\\app' }),
    ]);
    expect(groups.length).toBe(2);
    const names = groups.map((g) => g.name);
    // 两个 name 不应相同（消歧生效）
    expect(new Set(names).size).toBe(2);
    // 消歧后 name 应包含 basename
    expect(names.every((n) => n.endsWith('app'))).toBe(true);
  });

  it('keeps basename when no collision', () => {
    // 唯一 basename 不消歧（回归保护：现有行为）
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\other\\svc' }),
    ]);
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(['app', 'svc']);
  });

  it('dir (identity key) stays unique and normalized across same-basename groups', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\worktrees\\x\\app' }),
    ]);
    const dirs = groups.map((g) => g.dir);
    expect(new Set(dirs).size).toBe(2); // identity 键唯一
    expect(dirs).toContain('C:/proj/app');
    expect(dirs).toContain('C:/worktrees/x/app');
  });
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/projectGroup.test.ts`
Expected: FAIL —— "disambiguates same-basename groups by parent segment" 失败（当前两组 name 都是 `'app'`，`Set(names).size === 1`）。

- [ ] **Step 3: 实现消歧逻辑**

打开 `app/src/lib/projectGroup.ts`。在 `lastSegment` 函数（:22-26）之后，新增一个取倒数第 N 段的辅助函数和消歧主逻辑。

在 `lastSegment` 之后追加辅助函数：

```ts
/**
 * 从规范化路径取倒数 n 段拼接（n=1 等价 basename，n=2 = parent/basename …）。
 * 段不足时返回完整规范化路径。用于同名组逐级消歧显示名。
 */
function lastSegments(p: string, n: number): string {
  const norm = normPath(p);
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= n) return norm;
  return parts.slice(parts.length - n).join('/');
}
```

然后在 `groupByProject` 的返回前（`const groups = [...byDir.values()]...` 那一行之后，`if (ungrouped.length > 0)` 之前）插入消歧：

将这段：

```ts
  const groups = [...byDir.values()].sort((a, b) => b.pids.length - a.pids.length);
  if (ungrouped.length > 0) {
```

改为：

```ts
  const groups = [...byDir.values()].sort((a, b) => b.pids.length - a.pids.length);
  disambiguateNames(groups);
  if (ungrouped.length > 0) {
```

并在 `groupByProject` 函数之后（文件末尾）新增消歧函数：

```ts
/**
 * 对同名组逐级加父段消歧显示名。只改 group.name（显示），不改 group.dir（分组键）。
 * dir 为 null 的组（未分组）不参与——未分组在调用方单独 append，不传入此函数。
 *
 * 算法：从 n=1（basename）开始，统计每个 name 的冲突数；冲突的组升到 n+1 段，
 * 直到组间 name 唯一。实践中倒数两段几乎必然唯一。
 */
function disambiguateNames(groups: ProjectGroup[]): void {
  // 只处理有 dir 的组（dir===null 的未分组不在此列表）
  const withDir = groups.filter((g) => g.dir !== null) as (ProjectGroup & { dir: string })[];
  if (withDir.length === 0) return;
  let n = 1;
  // 上限：最长路径的段数（保证一定能消歧到完整路径）
  const maxSegs = Math.max(...withDir.map((g) => normPath(g.dir).split('/').filter(Boolean).length));
  while (n <= maxSegs) {
    // 计算每组的第 n 级候选名
    const candidate = new Map<ProjectGroup, string>();
    for (const g of withDir) candidate.set(g, lastSegments(g.dir, n));
    // 统计冲突
    const counts = new Map<string, number>();
    for (const name of candidate.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
    const hasCollision = [...counts.values()].some((c) => c > 1);
    if (!hasCollision) {
      // 无冲突：应用候选名，停止
      for (const g of withDir) g.name = candidate.get(g)!;
      return;
    }
    n++;
  }
  // 兜底：仍未唯一（理论上 maxSegs 时已是完整路径，必唯一）——用完整规范化路径
  for (const g of withDir) g.name = normPath(g.dir);
}
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/projectGroup.test.ts`
Expected: PASS —— 全部用例（原 12 + 新 3 = 15）通过。**特别注意**：原有 12 个用例不应因消歧逻辑挂（无冲突时 name 保持 basename）。

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/projectGroup.ts app/tests/projectGroup.test.ts
git commit -m "fix(app): disambiguate same-basename project groups by parent segment

Two worktrees both ending in 'app' (e.g. C:\\proj\\app, C:\\worktrees\\x\\app)
previously shared the same display name. groupByProject now disambiguates
display names by prepending parent path segments on collision. The grouping
key (normalized dir) was already correct and is unchanged."
```

---

## Task 3: Bug #3 — UI 与 store 改用 dir 作 identity 键

> 纯函数层消歧已完成。本 Task 把 React key 和 expandedGroups 从 name 迁到 `dir ?? name`。

**Files:**
- Modify: `app/src/components/ProjectGroupView.tsx:272-290`
- Modify: `app/src/store/processPanelStore.ts:127-130`
- Test: 人工验收（store 字段不持久化，无迁移测试；逻辑由现有 store 测试覆盖）

- [ ] **Step 1: 修改 ProjectGroupView 的 key 与展开态判定**

打开 `app/src/components/ProjectGroupView.tsx`。找到 `groups.map` 块（约 :272-292）。

将：

```tsx
          {groups.map((g) => {
            const procs = g.pids
              .map((pid) => procByPid.get(pid))
              .filter((x): x is ProcessInfo => !!x);
            return (
              <GroupRow
                key={g.name}
                name={g.name}
                dir={g.dir}
                pids={g.pids}
                totalMemory={g.totalMemory}
                procs={procs}
                isExpanded={expandedGroups.has(g.name)}
                cpuMap={cpuMap}
                onToggle={() => onToggle(g.name)}
```

改为（key、isExpanded、onToggle 三处改用 `g.dir ?? g.name`）：

```tsx
          {groups.map((g) => {
            const groupKey = g.dir ?? g.name; // identity 键：规范化 dir（未分组回退 name）
            const procs = g.pids
              .map((pid) => procByPid.get(pid))
              .filter((x): x is ProcessInfo => !!x);
            return (
              <GroupRow
                key={groupKey}
                name={g.name}
                dir={g.dir}
                pids={g.pids}
                totalMemory={g.totalMemory}
                procs={procs}
                isExpanded={expandedGroups.has(groupKey)}
                cpuMap={cpuMap}
                onToggle={() => onToggle(groupKey)}
```

- [ ] **Step 2: 确认 store 的 toggleGroup 无需改签名**

打开 `app/src/store/processPanelStore.ts:127-130`。`toggleGroup(name: string)` 签名是泛型 `string`，无需改——调用方现在传入的是 `dir ?? name`，store 只是存取字符串键，不关心语义。`expandedGroups: Set<string>` 类型也不变。

**不改 store 代码**。仅记录：`expandedGroups` 的元素语义从"组名"变为"组 identity 键（规范化 dir 或 '未分组'）"。

- [ ] **Step 3: 确认未分组的 identity 键**

未分组的 `dir` 为 `null`（`projectGroup.ts:67`），因此 `g.dir ?? g.name` 回退到 `g.name`（固定 `'未分组'`），与旧行为一致——零回归。

- [ ] **Step 4: 运行全量测试确认无回归**

Run: `cd app && pnpm vitest run`
Expected: PASS —— 全部 225+ 测试通过（processPanelStore 测试用 name 作键的用例仍兼容，因为未分组 dir=null 回退 name）。

- [ ] **Step 5: Commit**

```bash
git add app/src/components/ProjectGroupView.tsx
git commit -m "fix(app): project group identity key uses normalized dir not basename

React key and expandedGroups now key on g.dir ?? g.name (normalized full path,
falling back to name only for the ungrouped group whose dir is null). Fixes
two same-basename worktrees sharing expand state and colliding React keys."
```

---

## Task 4: Bug #1 — buildTree 保留输入顺序（排序不再被覆盖）

**Files:**
- Modify: `app/src/components/ProcessTable.tsx:26-63`
- Test: `app/tests/processTableSort.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `app/tests/processTableSort.test.tsx`：

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { usePerfStore } from '../src/store/perfStore';
import type { ProcessInfo } from '../electron/ipc-types';

// 桩 usePerfStore：ProcessTable 读 perfStore 的 GPU 数据，测试里置空避免无关渲染
vi.mock('../src/store/perfStore', () => ({
  usePerfStore: (sel: any) => sel({ current: null }),
}));

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'node.exe', cmdline: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, cwd: '',
  ...over,
});

function rowPids(): number[] {
  // 取所有数据行（跳过表头）的 PID 单元格文本，按出现顺序
  // 列序：checkbox(0) 名称(1) CPU(2) GPU(3) 内存(4) PID(5) …
  return screen.getAllByRole('row').slice(1).map((r) =>
    Number(r.querySelectorAll('td')[5]?.textContent?.trim() ?? '-1'),
  );
}

describe('ProcessTable sort', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree', expandedPids: new Set() });
  });

  it('sorts flat list by CPU descending when CPU header clicked twice', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, name: 'a.exe' }),
        p({ pid: 2, name: 'b.exe' }),
        p({ pid: 3, name: 'c.exe' }),
      ],
      cpuMap: { 1: 10, 2: 50, 3: 30 },
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // 点 CPU 表头第一次：切到 cpu 列（默认升序）→ 10,50,30
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([1, 2, 3]);
    // 点第二次：翻转降序 → 50,30,10
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([2, 3, 1]);
  });

  it('preserves sort order into tree DFS when expanded', () => {
    // pid 1 是 root，pid 2/3 是其子进程（ppid=1）。CPU 降序期望 root 先出现
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0, name: 'root.exe' }),
        p({ pid: 2, ppid: 1, name: 'childA.exe' }),
        p({ pid: 3, ppid: 1, name: 'childB.exe' }),
      ],
      cpuMap: { 1: 50, 2: 10, 3: 30 },
      expandedPids: new Set([1]), // 展开 root
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // CPU 列降序：root(50) 最先，其后子进程按 cpu 降序 30,10
    fireEvent.click(screen.getByText(/CPU%/));
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([1, 3, 2]);
  });

  it('defaults to PID ascending (zero regression)', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 30, name: 'c.exe' }),
        p({ pid: 10, name: 'a.exe' }),
        p({ pid: 20, name: 'b.exe' }),
      ],
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // 默认 sortKey=pid, sortAsc=true → 10,20,30
    expect(rowPids()).toEqual([10, 20, 30]);
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/processTableSort.test.tsx`
Expected: FAIL —— "sorts flat list by CPU descending" 失败。当前 buildTree 按 PID 重排，点 CPU 表头后行顺序仍是 PID 升序（1,2,3），第二次点击后也不会变成（2,3,1）。

- [ ] **Step 3: 删除 buildTree 内部的排序**

打开 `app/src/components/ProcessTable.tsx`。在 `buildTree`（:26-63）中：

删除 `walk` 函数里的这行（:39）：

```ts
    children.sort((a, b) => a.pid - b.pid);
```

删除 roots 排序这行（:53）：

```ts
  roots.sort((a, b) => a.pid - b.pid);
```

更新 `buildTree` 顶部注释（:20-25），在描述末尾加一句：

```ts
 * 顺序由调用方传入的 procs（已排序）决定；本函数只建立父子关系与 DFS 遍历，不重排。
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/processTableSort.test.tsx`
Expected: PASS —— 3 个用例通过。

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `cd app && pnpm vitest run`
Expected: PASS —— 全部通过。特别注意 `processTableKeyboard.test.tsx` 与 `processTableVirtual.test.tsx`：它们默认 `sortKey: 'pid'`，删除 buildTree 排序后行为不变（上层 sorted 已是 PID 升序）。

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ProcessTable.tsx app/tests/processTableSort.test.tsx
git commit -m "fix(app): process table sort no longer overridden by buildTree

buildTree was re-sorting roots and children by PID after the header sort
already applied the user's chosen key, making CPU/GPU/memory/name sorts
mostly ineffective. buildTree now preserves the input order from the
already-sorted list and only builds parent-child structure. Default
(pid ascending) behavior is unchanged."
```

---

## Task 5: Bug #2 — 全选只选可见行（不选折叠隐藏的子进程）

**Files:**
- Modify: `app/src/components/ProcessTable.tsx:315-318`（allSelected）、`:467-477`（表头 checkbox）
- Test: `app/tests/processTableSelect.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `app/tests/processTableSelect.test.tsx`：

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

vi.mock('../src/store/perfStore', () => ({
  usePerfStore: (sel: any) => sel({ current: null }),
}));

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'node.exe', cmdline: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, cwd: '',
  ...over,
});

// 取表头全选 checkbox（aria-label="全选可见行" 或 "全选当前列表"，兼容过渡）
function selectAllCheckbox(): HTMLInputElement {
  return screen.getByLabelText(/全选/) as HTMLInputElement;
}

describe('ProcessTable select-all visibility', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree' });
  });

  it('select-all with collapsed children selects only visible (root) rows', () => {
    // root pid 1，子进程 pid 2/3 折叠（expandedPids 不含 1）
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0 }),
        p({ pid: 2, ppid: 1 }),
        p({ pid: 3, ppid: 1 }),
      ],
      expandedPids: new Set(), // 折叠：子进程不可见
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    // 只有可见的 root(pid 1) 被选；折叠的 2/3 不选
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1]));
  });

  it('select-all with expanded children selects root + children', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0 }),
        p({ pid: 2, ppid: 1 }),
        p({ pid: 3, ppid: 1 }),
      ],
      expandedPids: new Set([1]), // 展开：子进程可见
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1, 2, 3]));
  });

  it('select-all after filtering selects only matching visible rows', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0, name: 'vite.exe' }),
        p({ pid: 2, ppid: 0, name: 'node.exe' }),
        p({ pid: 3, ppid: 0, name: 'node.exe' }),
      ],
      filter: 'node', // 只匹配 pid 2/3
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([2, 3]));
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/processTableSelect.test.tsx`
Expected: FAIL —— "select-all with collapsed children selects only visible (root) rows" 失败。当前全选用 `sorted`（含折叠子进程），点全选后 selectedPids 含 1,2,3。

- [ ] **Step 3: 修改 allSelected 与表头 checkbox**

打开 `app/src/components/ProcessTable.tsx`。

**3a. 改 allSelected**（约 :315-318）。将：

```tsx
  const allSelected = useMemo(
    () => selectedPids.size > 0 && sorted.every((p) => selectedPids.has(p.pid)),
    [selectedPids, sorted],
  );
```

改为（用 `rows` 代替 `sorted`）：

```tsx
  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selectedPids.has(r.proc.pid)),
    [selectedPids, rows],
  );
```

**3b. 改表头 checkbox**（约 :467-478）。将：

```tsx
              <input
                type="checkbox"
                aria-label="全选当前列表"
                checked={allSelected}
                onChange={() =>
                  allSelected
                    ? clearSelection()
                    : selectAll(sorted.map((p) => p.pid))
                }
                className="accent-accent"
              />
```

改为（用 `rows` 代替 `sorted`，更新 aria-label）：

```tsx
              <input
                type="checkbox"
                aria-label="全选可见行"
                checked={allSelected}
                onChange={() =>
                  allSelected
                    ? clearSelection()
                    : selectAll(rows.map((r) => r.proc.pid))
                }
                className="accent-accent"
              />
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/processTableSelect.test.tsx`
Expected: PASS —— 3 个用例通过。

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `cd app && pnpm vitest run`
Expected: PASS —— 全部通过。

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ProcessTable.tsx app/tests/processTableSelect.test.tsx
git commit -m "fix(app): select-all targets visible rows only, not collapsed children

The header select-all checkbox used the flat filtered list (sorted), which
includes children hidden under collapsed parents. A user seeing 3 root rows
could silently select 50 hidden children and batch-kill them. Select-all now
targets the actually-rendered rows (buildTree output), so 'what you see is
what you select'."
```

---

## Task 6: 全量验收

**Files:** 无（仅运行验收命令）

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS —— 全部测试通过（原 225 + 新增约 8 = ~233）。

- [ ] **Step 2: 类型检查**

Run: `cd app && pnpm typecheck`
Expected: 通过（无输出，exit 0）。

- [ ] **Step 3: 确认无 native / main / preload / IPC 改动**

Run: `git diff main...HEAD --stat -- codemgr-native app/electron`
Expected: 空（无输出）——证明改动全部在 `app/src` 与 `app/tests`，符合 spec §1.2。

- [ ] **Step 4: 更新 AGENTS.md §8 测试计数**

打开 `AGENTS.md`，找到 §8 的测试计数行（约 :163）：

```
- 测试：app 225/225 + native 47/47，共 272 PASS。
```

用实际新增后的计数替换（新增约 8 个用例：snapshotDiff +2、projectGroup +3、processTableSort +3、processTableSelect +3 = 11，但 snapshotDiff 改写净 +1）。以 Step 1 实际输出为准更新这一行，例如：

```
- 测试：app 236/236 + native 47/47，共 283 PASS。
```

（用真实数字，不要用这里的占位值。）

- [ ] **Step 5: 提交文档更新**

```bash
git add AGENTS.md
git commit -m "docs: update test count after A1 bugfix pack"
```

- [ ] **Step 6: 人工验收备忘（可选，记入 PR 描述）**

下列行为需真机 Electron 验证（jsdom 无法覆盖），实现完成后在 PR 描述记录：
1. 进程表点 CPU/GPU/内存表头，行顺序真实变化（排序生效）。
2. 折叠一个有多子进程的根，点全选，确认只选了可见行；批量结束确认框数量匹配可见行。
3. 同时打开两个 basename 相同的 worktree 项目，确认项目视图两组独立展开/收起，不互相影响。
4. 快照对比：存活 dev server 不再因内存波动进入"有变化"列表；改命令行的进程仍进 changed。

---

## 完成标志

- [ ] 6 个 Task 全部完成
- [ ] `cd app && pnpm vitest run` 全绿
- [ ] `cd app && pnpm typecheck` 绿
- [ ] `git diff main...HEAD --stat -- codemgr-native app/electron` 为空
- [ ] AGENTS.md 测试计数已更新
- [ ] 无 #4 采集失败语义改动（留 A2）
