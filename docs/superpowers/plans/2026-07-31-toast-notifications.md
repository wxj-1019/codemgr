# Toast 通知系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Toast 通知系统（store + host 组件 + notify 出口），把全仓库 ~38 处 `alert()` 与 2 处 `confirm()` 全部替换为非阻塞通知/ConfirmDialog。

**Architecture:** zustand `toastStore`（栈上限 5、按 kind 定时自动消失、定时器句柄模块级）+ `lib/notify.ts` 非 React 出口 + `ToastHost` portal 组件（z-70、role=status/alert）。替换逐文件进行，kill 结果语义：全失败/部分失败→error，全成功→success，校验提示→info。

**Tech Stack:** React 18、zustand、Vitest（fake timers）。

**Spec:** `docs/superpowers/specs/2026-07-31-toast-notifications-design.md`

---

### Task 1: toastStore + notify（TDD）

**Files:**
- Create: `app/src/store/toastStore.ts`
- Create: `app/src/lib/notify.ts`
- Test: `app/tests/toastStore.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `app/tests/toastStore.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToastStore, __resetToastStoreForTests } from '../src/store/toastStore';
import { notify } from '../src/lib/notify';

beforeEach(() => { vi.useFakeTimers(); __resetToastStoreForTests(); });
afterEach(() => { vi.useRealTimers(); });

describe('toastStore.push', () => {
  it('自增 id 入栈，kind 映射时长', () => {
    const s = useToastStore.getState();
    const id1 = s.push('success', 'a');
    const id2 = s.push('error', 'b');
    expect(id2).toBeGreaterThan(id1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toMatchObject({ kind: 'success', message: 'a', durationMs: 4000 });
    expect(toasts[1]).toMatchObject({ kind: 'error', message: 'b', durationMs: 8000 });
  });

  it('栈上限 5：第 6 条丢弃最旧且其定时器被清理', () => {
    const s = useToastStore.getState();
    for (let i = 1; i <= 5; i++) s.push('info', `m${i}`);
    s.push('info', 'm6');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(5);
    expect(toasts.map((t) => t.message)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
  });

  it('success 4000ms 自动消失，error 8000ms 前不消失', () => {
    const s = useToastStore.getState();
    s.push('success', 's');
    s.push('error', 'e');
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts.map((t) => t.kind)).toEqual(['error']);
    vi.advanceTimersByTime(3999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('dismiss 手动移除且幂等', () => {
    const s = useToastStore.getState();
    const id = s.push('info', 'x');
    s.dismiss(id);
    s.dismiss(id); // 幂等不抛错
    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.advanceTimersByTime(10000); // 定时器已清，无残留副作用
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('notify', () => {
  it('success/error/info 三出口写入 store', () => {
    notify.success('ok');
    notify.error('bad');
    notify.info('fyi');
    expect(useToastStore.getState().toasts.map((t) => [t.kind, t.message])).toEqual([
      ['success', 'ok'], ['error', 'bad'], ['info', 'fyi'],
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm vitest run tests/toastStore.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

创建 `app/src/store/toastStore.ts`：

```ts
import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
}

const MAX_TOASTS = 5;
const DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, error: 8000 };

// 定时器句柄与 id 计数放模块级（不进 state，瞬态 UI 态不 persist）：
// dismiss/丢弃最旧时清理对应定时器，防泄漏。
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function clearTimer(id: number): void {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string) => number;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    const item: ToastItem = { id, kind, message, durationMs: DURATION[kind] };
    const kept = [...get().toasts, item];
    // 超上限丢弃最旧：连带清掉其自动消失定时器
    for (const d of kept.slice(0, Math.max(0, kept.length - MAX_TOASTS))) clearTimer(d.id);
    set({ toasts: kept.slice(-MAX_TOASTS) });
    timers.set(id, setTimeout(() => get().dismiss(id), item.durationMs));
    return id;
  },
  dismiss: (id) => {
    clearTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** 仅测试用：清空栈/定时器并重置 id 计数，防用例间泄漏。 */
export function __resetToastStoreForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  nextId = 1;
  useToastStore.setState({ toasts: [] });
}
```

创建 `app/src/lib/notify.ts`：

```ts
// 非 React 通知出口：异步回调（kill 结果、IPC 错误）用不了 hook，统一从这里发 toast。
import { useToastStore } from '../store/toastStore';

export const notify = {
  success: (message: string): void => { useToastStore.getState().push('success', message); },
  error: (message: string): void => { useToastStore.getState().push('error', message); },
  info: (message: string): void => { useToastStore.getState().push('info', message); },
};
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `cd app && pnpm vitest run tests/toastStore.test.ts`
Expected: PASS（5 用例）

```bash
git add app/src/store/toastStore.ts app/src/lib/notify.ts app/tests/toastStore.test.ts
git commit -m "feat(app): toast store + notify outlet (capped stack, auto-dismiss by kind)"
```

---

### Task 2: ToastHost 组件 + App 挂载（TDD）

**Files:**
- Create: `app/src/components/ToastHost.tsx`
- Modify: `app/src/App.tsx`（PluginHost 旁挂载）
- Test: `app/tests/toastHost.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `app/tests/toastHost.test.tsx`：

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastHost } from '../src/components/ToastHost';
import { useToastStore, __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => { vi.useFakeTimers(); __resetToastStoreForTests(); });
afterEach(() => { vi.useRealTimers(); });

describe('ToastHost', () => {
  it('按 store 渲染条目，error 用 role=alert，其余 role=status', () => {
    useToastStore.getState().push('success', '已完成');
    useToastStore.getState().push('error', '失败了');
    render(<ToastHost />);
    expect(screen.getByText('已完成').closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText('失败了').closest('[role="alert"]')).toBeTruthy();
  });

  it('空栈不渲染', () => {
    const { container } = render(<ToastHost />);
    expect(container.firstChild).toBeNull();
  });

  it('点关闭按钮 dismiss 对应条目', () => {
    useToastStore.getState().push('info', '可关闭');
    render(<ToastHost />);
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm vitest run tests/toastHost.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

创建 `app/src/components/ToastHost.tsx`：

```tsx
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore, type ToastKind } from '../store/toastStore';
import { IconButton } from './ui/IconButton';
import { CheckCircle2, CircleX, Info, X } from './icons';

const KIND_META: Record<ToastKind, { icon: ReactElement; iconCls: string; role: 'status' | 'alert' }> = {
  success: { icon: <CheckCircle2 size={15} aria-hidden="true" />, iconCls: 'text-success', role: 'status' },
  error: { icon: <CircleX size={15} aria-hidden="true" />, iconCls: 'text-danger', role: 'alert' },
  info: { icon: <Info size={15} aria-hidden="true" />, iconCls: 'text-accent', role: 'status' },
};

/**
 * Toast 堆叠宿主：右下角 fixed，z-70（高于 ContextMenu z-60）。
 * 单条可手动关闭；自动消失由 toastStore 的定时器负责（success/info 4s，error 8s）。
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const meta = KIND_META[t.kind];
        return (
          <div
            key={t.id}
            role={meta.role}
            className="glass-elevated flex items-center gap-2 rounded-lg px-3 py-2 text-sm shadow-2xl"
          >
            <span className={`shrink-0 ${meta.iconCls}`}>{meta.icon}</span>
            <span className="min-w-0 flex-1 break-words text-fg-primary">{t.message}</span>
            <IconButton label="关闭通知" size="xs" onClick={() => dismiss(t.id)}><X /></IconButton>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
```

`App.tsx`：import 区加 `import { ToastHost } from './components/ToastHost';`；根 div 内 `<PluginHost />` 之后加 `<ToastHost />`。

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `cd app && pnpm vitest run tests/toastHost.test.tsx`
Expected: PASS

```bash
git add app/src/components/ToastHost.tsx app/src/App.tsx app/tests/toastHost.test.tsx
git commit -m "feat(app): toast host component mounted at workspace root"
```

---

### Task 3: shellClient 换 notify + 重命名（4 个调用文件同步）

**Files:**
- Modify: `app/src/lib/shellClient.ts`
- Modify: `app/src/components/ProcessTable.tsx`
- Modify: `app/src/components/ProjectGroupView.tsx`
- Modify: `app/src/components/PortTable.tsx`
- Modify: `app/src/components/ProcessDetailSidebar.tsx`

- [ ] **Step 1: shellClient.ts 重写**

```ts
// shell 跳转动作的渲染层统一出口。所有 UI 调用点走这里，失败经 toast 反馈（子项目 B）。
import { ipc } from './ipc';
import { notify } from './notify';
import type { OpenTargetKind } from '../../electron/ipc-types';

export async function openTargetOrNotify(kind: OpenTargetKind, path: string): Promise<void> {
  try {
    const err = await ipc.openTarget(kind, path);
    if (err) notify.error(err);
  } catch (e) {
    notify.error(`打开失败：${String(e)}`);
  }
}

export async function openExternalUrlOrNotify(url: string): Promise<void> {
  try {
    const err = await ipc.openExternalUrl(url);
    if (err) notify.error(err);
  } catch (e) {
    notify.error(`打开失败：${String(e)}`);
  }
}

export function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => { /* blocked */ });
}
```

- [ ] **Step 2: 四个调用文件改名**

全部 `openTargetOrAlert` → `openTargetOrNotify`、`openExternalUrlOrAlert` → `openExternalUrlOrNotify`（含 import 与调用点）：
- `ProcessTable.tsx`（import 1 处 + 菜单 handler 1 处）
- `ProjectGroupView.tsx`（import 1 处 + 菜单 handler 1 处 + GroupRow 3 处）
- `PortTable.tsx`（import 1 处 + onBrowse 1 处 + Globe 按钮 1 处）
- `ProcessDetailSidebar.tsx`（import 1 处 + 3 个 IconButton）

- [ ] **Step 3: typecheck + Commit**

Run: `cd app && pnpm typecheck`
Expected: 无错误（改名漏网会编译报错）

```bash
git add app/src/lib/shellClient.ts app/src/components/ProcessTable.tsx app/src/components/ProjectGroupView.tsx app/src/components/PortTable.tsx app/src/components/ProcessDetailSidebar.tsx
git commit -m "refactor(app): shell client reports via toast, rename OrAlert to OrNotify"
```

---

### Task 4: PortRadar / SessionPanel / ProcessPanel 替换

**Files:**
- Modify: `app/src/components/PortRadar.tsx`
- Modify: `app/src/components/SessionPanel.tsx`
- Modify: `app/src/components/ProcessPanel.tsx`

- [ ] **Step 1: PortRadar.tsx**

import 加 `import { notify } from '../lib/notify';`。
- `alert(\`结束 ${pendingKill.name} (PID ${pendingKill.pid}) 失败：受保护进程、权限不足或进程已退出。\`);` → `notify.error(\`结束 ${pendingKill.name} (PID ${pendingKill.pid}) 失败：受保护进程、权限不足或进程已退出。\`);`
- `alert(\`结束失败：${String(e)}\`);` → `notify.error(\`结束失败：${String(e)}\`);`

- [ ] **Step 2: SessionPanel.tsx**

import 加 notify。
- `alert('未结束任何进程：根进程可能受保护、权限不足或已退出');` → `notify.error('未结束任何进程：根进程可能受保护、权限不足或已退出');`
- `alert(\`停止会话失败：${String(e)}\`);` → `notify.error(\`停止会话失败：${String(e)}\`);`

- [ ] **Step 3: ProcessPanel.tsx**（12 处，语义：全失败/部分失败→error，全成功→success）

import 加 notify。逐块替换：

```ts
// doKillSingle
alert('结束失败：受保护进程、权限不足或进程已退出');
→ notify.error('结束失败：受保护进程、权限不足或进程已退出');
alert(`结束失败：${String(e)}`);
→ notify.error(`结束失败：${String(e)}`);

// doBatchKillByName（结果分级）
if (killed === 0) {
  alert('未结束任何进程：可能均为受保护进程、权限不足或已退出');
} else if (killed < targets.length) {
  alert(`已结束 ${killed}/${targets.length} 个进程（其余受保护/无权限/已退出）`);
} else {
  alert(`已结束 ${killed} 个进程`);
}
→
if (killed === 0) {
  notify.error('未结束任何进程：可能均为受保护进程、权限不足或已退出');
} else if (killed < targets.length) {
  notify.error(`已结束 ${killed}/${targets.length} 个进程（其余受保护/无权限/已退出）`);
} else {
  notify.success(`已结束 ${killed} 个进程`);
}
alert(`批量结束失败：${String(e)}`);
→ notify.error(`批量结束失败：${String(e)}`);

// doKillAllNode
alert(killed === 0
  ? '未结束任何 node.exe：可能权限不足或进程已退出'
  : `已结束 ${killed} 个 node.exe 进程`);
→
if (killed === 0) notify.error('未结束任何 node.exe：可能权限不足或进程已退出');
else notify.success(`已结束 ${killed} 个 node.exe 进程`);
alert(`结束 node.exe 失败：${String(e)}`);
→ notify.error(`结束 node.exe 失败：${String(e)}`);

// doGroupKill（同 doBatchKillByName 分级模式，消息保留「${name}」）
// doKillTree
alert(killed === 0
  ? '未结束任何进程：根进程可能受保护、权限不足或已退出'
  : `已结束进程树，共 ${killed} 个进程`);
→
if (killed === 0) notify.error('未结束任何进程：根进程可能受保护、权限不足或已退出');
else notify.success(`已结束进程树，共 ${killed} 个进程`);
alert(`结束进程树失败：${String(e)}`);
→ notify.error(`结束进程树失败：${String(e)}`);
```

- [ ] **Step 4: 检查残留 + Commit**

Run: `grep -n "alert(" app/src/components/PortRadar.tsx app/src/components/SessionPanel.tsx app/src/components/ProcessPanel.tsx`
Expected: 无输出

```bash
git add app/src/components/PortRadar.tsx app/src/components/SessionPanel.tsx app/src/components/ProcessPanel.tsx
git commit -m "feat(app): kill feedback via toast in port radar, sessions, process panel"
```

---

### Task 5: SnapshotPanel / RunProfilesPanel 替换（含删除 ConfirmDialog）

**Files:**
- Modify: `app/src/components/SnapshotPanel.tsx`
- Modify: `app/src/components/RunProfilesPanel.tsx`

- [ ] **Step 1: SnapshotPanel.tsx**

import 加 notify。替换：
- `alert('请先输入快照名称（如「agent 开工前」）');` → `notify.info('请先输入快照名称（如「agent 开工前」）');`
- `alert(\`取当前进程失败：${result.error.message}\`);` → `notify.error(...)`（同消息）
- `alert(\`拍快照失败：${String(e)}\`);` → `notify.error(...)`
- 批量 kill 三分支 → Task 4 的分级模式（0→error、部分→error、全成→success）
- `alert(\`批量结束失败：${String(e)}\`);` → `notify.error(...)`

- [ ] **Step 2: RunProfilesPanel.tsx**

import 加 `notify` 与 `import { ConfirmDialog } from './ConfirmDialog';`。替换：
- `if (!r) alert('启动失败：command 不在白名单或 cwd 无效');` → `if (!r) notify.error('启动失败：command 不在白名单或 cwd 无效');`
- `catch (e) { alert(\`启动失败：${String(e)}\`); }` → `catch (e) { notify.error(\`启动失败：${String(e)}\`); }`
- 停止/重启 catch 同样换 notify.error
- 删除确认从 confirm 改为 ConfirmDialog：

```tsx
// 组件 state 区加：
const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

// del 函数改为：
function del(profileId: string) { setConfirmDelId(profileId); }
async function doDelete() {
  if (!confirmDelId) return;
  setConfirmDelId(null);
  await ipc.deleteRunProfile(confirmDelId);
  await refreshProfiles();
}

// JSX 末尾（面板根 div 内）加：
<ConfirmDialog
  open={confirmDelId !== null}
  title="删除 Profile"
  message="确定删除此 profile？"
  confirmLabel="删除"
  onConfirm={() => void doDelete()}
  onCancel={() => setConfirmDelId(null)}
/>
```

- [ ] **Step 3: 检查残留 + 测试 + Commit**

Run: `grep -n "alert(\|confirm(" app/src/components/SnapshotPanel.tsx app/src/components/RunProfilesPanel.tsx`
Expected: 无输出

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: 全 PASS

```bash
git add app/src/components/SnapshotPanel.tsx app/src/components/RunProfilesPanel.tsx
git commit -m "feat(app): snapshot & run profiles feedback via toast; delete confirm to ConfirmDialog"
```

---

### Task 6: LabelRuleEditor 替换（含导入 ConfirmDialog）

**Files:**
- Modify: `app/src/components/LabelRuleEditor.tsx`

- [ ] **Step 1: 替换**

import 加 `notify` 与 ConfirmDialog。导出两处 alert → notify.error。导入逻辑改为确认门控：

```tsx
// state 区加：
const [confirmImport, setConfirmImport] = useState(false);

// 原 importRules（含 confirm('导入将替换现有规则，确定继续吗？')）改为：
async function importRules() {
  if (ioBusy) return;
  // 已有规则时先确认（ConfirmDialog），空规则直接导入
  if (userRules.length > 0 || disabledDefaultIds.length > 0 || Object.keys(overrides).length > 0) {
    setConfirmImport(true);
    return;
  }
  await doImport();
}

async function doImport() {
  setConfirmImport(false);
  setIoBusy(true);
  try {
    const snapshot = await ipc.importLabelRules();
    if (snapshot === null) {
      notify.error('导入失败：文件无效或已取消');
      return;
    }
    const n = replaceAll(snapshot);
    notify.success(`已导入规则（${n} 条自定义 + ${snapshot.disabledDefaultIds.length} 个默认开关变更）`);
  } catch (e) {
    notify.error(`导入失败：${String(e)}`);
  } finally {
    setIoBusy(false);
  }
}

// JSX 末尾加（编辑器 modal 内部最后，portal 渲染层级在其上）：
<ConfirmDialog
  open={confirmImport}
  title="导入标签规则"
  message="导入将替换现有规则，确定继续吗？"
  confirmLabel="导入"
  busy={ioBusy}
  onConfirm={() => void doImport()}
  onCancel={() => setConfirmImport(false)}
/>
```

- [ ] **Step 2: 全仓残留检查 + 全量测试**

Run: `grep -rn "alert(\|confirm(" app/src --include="*.tsx" --include="*.ts" | grep -v ConfirmDialog`
Expected: 无输出

Run: `cd app && pnpm typecheck && pnpm vitest run`
Expected: 全 PASS（LabelRuleEditor 测试若触发导入确认流，按 ConfirmDialog 交互更新）

- [ ] **Step 3: Commit**

```bash
git add app/src/components/LabelRuleEditor.tsx app/tests
git commit -m "feat(app): label rule editor IO feedback via toast; import replace confirm to ConfirmDialog"
```

---

### Task 7: 收口（全量验证 + CHANGELOG）

- [ ] **Step 1: 全量回归**

Run: `cd app && pnpm vitest run && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 2: CHANGELOG 追加**

```markdown
- Toast 通知系统：操作反馈（kill 结果/快照/标签规则导入导出/RunProfile 启停/shell 打开失败）从原生 alert/confirm 全面迁移为非阻塞 toast（右下角堆叠，success/info 4s、error 8s 自动消失，可手动关闭）；标签规则导入替换与 RunProfile 删除改用 ConfirmDialog。
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for toast notifications"
```

---

## Self-Review 记录

- Spec §3.1 store → Task 1；§3.2 notify → Task 1；§3.3 ToastHost+挂载 → Task 2；§3.4 替换映射 → Task 3-6 全覆盖（shellClient/PortRadar/ProcessPanel/SessionPanel/SnapshotPanel/RunProfilesPanel/LabelRuleEditor + 2 处 confirm）；§4 测试 → Task 1/2 + 各 Task 回归。
- 类型一致性：`ToastKind`/`ToastItem`/`__resetToastStoreForTests` 在 Task 1 定义，Task 2 复用；`notify` 三方法与 Task 1 测试断言一致。
- 风险：LabelRuleEditor/RunProfilesPanel 既有测试若走 import/delete 流，confirm 改 ConfirmDialog 后需同步断言——Task 5/6 的全量 vitest 会暴露，按 ConfirmDialog 交互修。
