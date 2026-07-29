# CodeMgr C — 全局聚焦上下文 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增全局 focusedPid，让端口/GPU Top5/快照 diff 点击后定位到进程表（高亮+滚动），详情侧栏跟随焦点；与进程表多选独立。

**Architecture:** 新建 `focusStore`（全局单值 focusedPid + sourcePanel）。ProcessTable 重命名内部导航焦点为 navFocusPid 避免冲突，消费全局 focusedPid 做高亮+滚动。端口/GPU/快照面板写入 focusedPid。侧栏无多选时跟随 focusedPid。纯渲染层，无 IPC/native。

**Tech Stack:** React 18 + TypeScript + Zustand + Vitest。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-c-focus-context.md`

**分支:** `docs/a1-bugfix-spec`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新建 store | `app/src/store/focusStore.ts` | 全局 focusedPid + sourcePanel + focus() |
| 改 | `app/src/components/ProcessTable.tsx` | 重命名内部 focusedPid→navFocusPid；消费全局 focusedPid 高亮+滚动+点击设聚焦 |
| 改 | `app/src/store/processPanelStore.ts` | setProcesses prune 时清空全局 focusedPid（跨 store） |
| 改 | `app/src/components/PortTable.tsx` + `PortRadar.tsx` | 端口行点击额外设 focusedPid |
| 改 | `app/src/components/PerfPanel.tsx` | GPU Top5 PID 行可点击设 focusedPid |
| 改 | `app/src/components/SnapshotPanel.tsx` | added 行加"定位"按钮设 focusedPid |
| 改 | `app/src/components/ProcessDetailSidebar.tsx` | 无多选时跟随 focusedPid |
| 测试 | `app/tests/focusStore.test.ts`（新建） | store TDD |
| mock | `app/tests/setup.ts` | 无需（focusStore 不经 IPC） |

---

## Task 1: focusStore（TDD）

**Files:**
- Create: `app/src/store/focusStore.ts`
- Test: `app/tests/focusStore.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `app/tests/focusStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useFocusStore } from '../src/store/focusStore';

describe('focusStore', () => {
  beforeEach(() => {
    useFocusStore.getState().focus(null);
  });

  it('initial state is null', () => {
    expect(useFocusStore.getState().focusedPid).toBeNull();
    expect(useFocusStore.getState().sourcePanel).toBeNull();
  });

  it('focus(pid, source) sets both', () => {
    useFocusStore.getState().focus(1234, 'port');
    expect(useFocusStore.getState().focusedPid).toBe(1234);
    expect(useFocusStore.getState().sourcePanel).toBe('port');
  });

  it('focus(null) clears both', () => {
    useFocusStore.getState().focus(1234, 'perf');
    useFocusStore.getState().focus(null);
    expect(useFocusStore.getState().focusedPid).toBeNull();
    expect(useFocusStore.getState().sourcePanel).toBeNull();
  });

  it('focus(pid) without source defaults sourcePanel to null', () => {
    useFocusStore.getState().focus(5678);
    expect(useFocusStore.getState().focusedPid).toBe(5678);
    expect(useFocusStore.getState().sourcePanel).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/focusStore.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 focusStore**

新建 `app/src/store/focusStore.ts`：

```ts
import { create } from 'zustand';

export type PanelSource = 'port' | 'process' | 'perf' | 'snapshot';

interface FocusState {
  /** 全局聚焦的进程 PID（单值）。null=无聚焦。与 selectedPids（多选）独立（C）。 */
  focusedPid: number | null;
  /** 触发聚焦的来源面板（首版仅存储，用于调试/未来 UI 提示）。 */
  sourcePanel: PanelSource | null;
  /** 设聚焦。pid=null 清空（sourcePanel 一并清空）。 */
  focus: (pid: number | null, source?: PanelSource) => void;
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedPid: null,
  sourcePanel: null,
  focus: (pid, source = null) => set({ focusedPid: pid, sourcePanel: pid == null ? null : source }),
}));
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/focusStore.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/src/store/focusStore.ts app/tests/focusStore.test.ts
git commit -m "feat(app): focusStore — global focusedPid (C)"
```

---

## Task 2: ProcessTable 重命名内部 focusedPid → navFocusPid

> 先消除命名冲突，再消费全局 focusedPid。纯重命名，不改行为。

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`（:360-451，12 处引用）

- [ ] **Step 1: 重命名 state + setter**

`app/src/components/ProcessTable.tsx:360`：

```ts
  const [focusedPid, setFocusedPid] = useState<number | null>(null);
```

改为：

```ts
  const [navFocusPid, setNavFocusPid] = useState<number | null>(null);
```

- [ ] **Step 2: 替换所有引用**

文件内所有 `focusedPid`（非全局 store 的）→ `navFocusPid`，`setFocusedPid` → `setNavFocusPid`。涉及行（按 grep 已知）：
- `:379` 注释 "只挂在 focusedPid 上" → "只挂在 navFocusPid 上"
- `:381` `if (focusedPid == null)` → `if (navFocusPid == null)`
- `:383` `r.proc.pid === focusedPid` → `=== navFocusPid`
- `:390` deps `[focusedPid, ...]` → `[navFocusPid, ...]`
- `:397` `if (focusedPid == null)` → `if (navFocusPid == null)`
- `:400` deps `[focusedPid, virtualItems]` → `[navFocusPid, virtualItems]`
- `:409` `setFocusedPid(...)` → `setNavFocusPid(...)`
- `:412` 同上
- `:418` `setFocusedPid(cur[0].proc.pid)` → `setNavFocusPid(...)`
- `:421` `setFocusedPid(cur[cur.length-1].proc.pid)` → `setNavFocusPid(...)`
- `:451` `isFocused={proc.pid === focusedPid}` → `=== navFocusPid`

（用 Edit replace_all 逐个替换 `focusedPid` → `navFocusPid` 和 `setFocusedPid` → `setNavFocusPid`，但注意此时文件内还没有全局 focusedPid 引用，所以 replace_all 安全。）

- [ ] **Step 3: typecheck + 测试确认零回归**

Run: `cd app && pnpm typecheck && pnpm vitest run tests/processTableKeyboard.test.tsx tests/processTableVirtual.test.tsx tests/processTableSort.test.tsx tests/processTableSelect.test.tsx`
Expected: PASS（纯重命名，行为不变）。

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ProcessTable.tsx
git commit -m "refactor(app): rename ProcessTable internal focusedPid → navFocusPid (C)

Frees the 'focusedPid' name for the global cross-panel focus (C). Pure
rename, no behavior change — keyboard nav focus (roving tabindex) is now
navFocusPid."
```

---

## Task 3: ProcessTable 消费全局 focusedPid（高亮 + 滚动 + 点击设聚焦）

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`

- [ ] **Step 1: 读取全局 focusedPid + 点击设聚焦**

在 ProcessTable 组件内（store 解构区附近）加：

```ts
  const focusedPid = useFocusStore((s) => s.focusedPid);
  const focus = useFocusStore((s) => s.focus);
```

并在顶部 import：

```ts
import { useFocusStore } from '../store/focusStore';
```

- [ ] **Step 2: 滚动定位 effect**

在现有 navFocusPid 滚动 effect 之后，加一个全局 focusedPid 滚动 effect：

```ts
  // 全局聚焦（C）：focusedPid 变化时滚动到该行（虚拟化用 virtualizer，否则 scrollIntoView）。
  // 与 navFocusPid（键盘焦点）滚动分开：全局聚焦来自外部面板点击。
  useEffect(() => {
    if (focusedPid == null) return;
    const idx = rowsRef.current.findIndex((r) => r.proc.pid === focusedPid);
    if (idx === -1) return;
    if (shouldVirtualize) {
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    } else {
      const el = tableRef.current?.querySelector<HTMLTableRowElement>(`[data-pid="${focusedPid}"]`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedPid, shouldVirtualize, virtualizer]);
```

- [ ] **Step 3: 行加 data-pid + 聚焦高亮**

ProcessRow 的 `<tr>`（约 :119）加 `data-pid={proc.pid}` 属性（供滚动定位 querySelector）。

聚焦高亮：ProcessRow props 加 `isFocusedGlobal?: boolean`，`<tr>` className 加聚焦样式。在 renderRow 调用处传 `isFocusedGlobal={proc.pid === focusedPid}`。

`<tr>` className 追加：

```tsx
      } ${isFocusedGlobal ? 'ring-2 ring-inset ring-cyan-400/70' : ''}`}
```

（cyan 光环与多选选中态 `bg-base-700/50` 视觉区分。）

ProcessRow 接口加：

```ts
  isFocusedGlobal?: boolean;
```

- [ ] **Step 4: 点击进程行设全局聚焦**

ProcessRow 的 `<tr>` onClick（现有 `onToggleSelect`）追加设聚焦。在 ProcessTable 的 onToggleSelect 包装处或 renderRow 处加。最简：renderRow 内传一个新的 onClick 包装：

在 renderRow 上方加：

```ts
  const onRowClick = useCallback((pid: number) => {
    toggleSelect(pid);
    focus(pid, 'process');
  }, [toggleSelect, focus]);
```

ProcessRow 的 onClick 改为调 onRowClick（需把 onRowClick 作为 prop 传入，或复用现有 onToggleSelect 的调用点）。最稳妥：ProcessRow 内 onClick 现调 `onToggleSelect(proc.pid)`，改为调一个新 prop `onRowClick`。

（为减少改动：在 ProcessRow 内 onClick 保持 onToggleSelect，额外在 ProcessTable renderRow 的 ProcessRow 上加一个 onClickCapture 或改 ProcessRow onClick 调两个。**最简决策**：ProcessRow 加 `onFocusPid?: (pid:number)=>void` prop，onClick 里 `onToggleSelect(pid); onFocusPid?.(pid)`。renderRow 传 `onFocusPid={(pid)=>focus(pid,'process')}`。）

- [ ] **Step 5: typecheck + 测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ProcessTable.tsx
git commit -m "feat(app): ProcessTable consumes global focusedPid (C)

Highlights (cyan ring) and scrolls to the globally-focused process row.
Clicking a process row also sets global focus (source=process). Coexists
with multi-select."
```

---

## Task 4: 端口行点击设全局聚焦

**Files:**
- Modify: `app/src/components/PortTable.tsx`
- Modify: `app/src/components/PortRadar.tsx`

- [ ] **Step 1: PortTable onSelect 同时设聚焦**

`app/src/components/PortTable.tsx` 行点击（约 :80 `onClick={() => onSelect(c.pid)}`）改为额外设聚焦。但 PortTable 不直接持有 focusStore——通过现有 onSelect 回调链。

**决策**：在 PortRadar 的 onSelect 回调里同时设聚焦（PortTable 不变，保持纯展示组件）。`app/src/components/PortRadar.tsx:99`：

```tsx
            onSelect={(pid) => select(pid)}
```

改为：

```tsx
            onSelect={(pid) => { select(pid); focus(pid, 'port'); }}
```

并在 PortRadar 顶部加：

```tsx
import { useFocusStore } from '../store/focusStore';
```

组件内加：

```tsx
  const focus = useFocusStore((s) => s.focus);
```

- [ ] **Step 2: typecheck + 测试**

Run: `cd app && pnpm typecheck && pnpm vitest run tests/PortTable.test.tsx`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/components/PortRadar.tsx
git commit -m "feat(app): port row click sets global focusedPid (C)"
```

---

## Task 5: GPU Top5 PID 行可点击设聚焦

**Files:**
- Modify: `app/src/components/PerfPanel.tsx`

- [ ] **Step 1: GPU Top5 行加 onClick**

`app/src/components/PerfPanel.tsx` GPU Top5 的 `<tr>`（约 :405）改为可点击。把：

```tsx
                <tr key={p.pid} className="border-t border-base-700/30">
```

改为：

```tsx
                <tr
                  key={p.pid}
                  onClick={() => focus(p.pid, 'perf')}
                  className="cursor-pointer border-t border-base-700/30 hover:bg-base-700/30"
                  title="点击在进程表定位此进程"
                >
```

在 PerfPanel（GpuView 组件内，因 Top5 在 GpuView）加 focus 读取。GpuView 是子组件——需在 GpuView 内 `const focus = useFocusStore((s) => s.focus);` 并 import。

定位 GpuView 函数签名（约 :330 附近 `function GpuView(...)`），在其内加：

```ts
  const focus = useFocusStore((s) => s.focus);
```

并 import（PerfPanel 顶部）：

```ts
import { useFocusStore } from '../store/focusStore';
```

- [ ] **Step 2: typecheck + 测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/components/PerfPanel.tsx
git commit -m "feat(app): GPU Top5 PID row clickable to focus process (C)"
```

---

## Task 6: 快照 diff added 行加"定位"按钮

**Files:**
- Modify: `app/src/components/SnapshotPanel.tsx`

- [ ] **Step 1: added 行加定位按钮**

读 `app/src/components/SnapshotPanel.tsx` 的 added 渲染区（搜索 `diff.added` 渲染处）。在每条 added 行的操作区加一个小"定位"按钮：

```tsx
<button
  onClick={() => focus(entry.pid, 'snapshot')}
  className="text-accent hover:underline text-xs"
  title="在进程表定位此进程（若仍存活）"
>
  定位
</button>
```

在 SnapshotPanel 组件内加：

```ts
  const focus = useFocusStore((s) => s.focus);
```

并 import：

```ts
import { useFocusStore } from '../store/focusStore';
```

注意：added 是快照后新起的进程，定位时它可能仍存活也可能已退出。进程表若无对应行，focusedPid 仍设但 ProcessTable 滚动 effect 的 findIndex 返回 -1 不滚动（§Task3 Step2 已处理）。聚焦后若该 PID 不在 processScan 结果里，Task7 的清理会清空 focusedPid。

- [ ] **Step 2: typecheck + 测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/components/SnapshotPanel.tsx
git commit -m "feat(app): snapshot diff added rows 'locate' button (C)"
```

---

## Task 7: focusedPid 自动清理（进程退出）+ 侧栏跟随

**Files:**
- Modify: `app/src/store/processPanelStore.ts`
- Modify: `app/src/components/ProcessDetailSidebar.tsx`

- [ ] **Step 1: setProcesses prune 时清空全局聚焦**

`app/src/store/processPanelStore.ts` 的 `setProcesses`（prune 块内，gitIdentityByPid prune 之后）加跨 store 清理。focusStore 不依赖 processPanelStore，单向 import 无循环依赖风险。

顶部加：

```ts
import { useFocusStore } from './focusStore';
```

prune 块内（gitIdentityByPid prune 之后，return 之前）加：

```ts
        // 全局聚焦清理（C）：focusedPid 指向的进程已退出 → 清空，防指向幽灵
        const curFocus = useFocusStore.getState().focusedPid;
        if (curFocus != null && !pidSet.has(curFocus)) {
          useFocusStore.getState().focus(null);
        }
```

- [ ] **Step 2: 侧栏无多选时跟随 focusedPid**

`app/src/components/ProcessDetailSidebar.tsx`：现有 `const pid = selectedPids.size === 1 ? [...selectedPids][0] : null;`（约 :21）改为：

```ts
  const focusedPid = useFocusStore((s) => s.focusedPid);
  // 优先级：单选态 > 全局聚焦。无单选时侧栏跟随全局聚焦（C）。
  const pid = selectedPids.size === 1 ? [...selectedPids][0] : focusedPid;
```

并 import：

```tsx
import { useFocusStore } from '../store/focusStore';
```

- [ ] **Step 3: typecheck + 全量测试**

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add app/src/store/processPanelStore.ts app/src/components/ProcessDetailSidebar.tsx
git commit -m "feat(app): auto-clear focusedPid on process exit + sidebar follows focus (C)"
```

---

## Task 8: 全量验收

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（含新增 focusStore 4 用例）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native/IPC 改动**

Run: `git diff <c-spec-commit>..HEAD --stat -- codemgr-native app/electron`
Expected: 空。

- [ ] **Step 4: 更新 AGENTS.md §8**

用实际测试数更新。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after C focus context"
```

- [ ] **Step 6: 人工验收（记 PR）**

1. 端口雷达点一个端口行 → 进程表对应行高亮（cyan 环）+ 滚动到可见 + 侧栏显示其详情。
2. GPU Top5 点一个 PID → 同上。
3. 快照 diff added 项点"定位" → 进程表定位（若存活）。
4. 聚焦一个进程后用多选选另外几个 → 聚焦高亮仍在原进程，多选独立。
5. 聚焦的进程退出 → focusedPid 自动清空（高亮消失）。
