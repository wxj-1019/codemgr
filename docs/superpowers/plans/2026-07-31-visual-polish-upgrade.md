# 视觉精致度升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统性统一 CodeMgr 的视觉语言——消灭遗留令牌、统一交互模式、建立 Toast 通知、迁移落后组件——达到 Linear/Raycast 级精致度。

**Architecture:** 自底向上 4 阶段：Phase 1 清理基础设施（令牌/按钮/圆角/间距/阴影/变量），Phase 2 统一交互（过渡/焦点/毛玻璃），Phase 3 建立 Toast 系统替换 alert()，Phase 4 迁移 PerfPanel + 淘汰 LoadState。

**Tech Stack:** React 18, Tailwind CSS, Zustand, Lucide React, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-07-31-visual-polish-upgrade-design.md`

---

## Phase 1：基础设施清理

### Task 1.1：遗留令牌清除 — 轻度组件

**Files:**
- Modify: `app/src/components/ContextMenu.tsx`
- Modify: `app/src/components/DiagnosticPreview.tsx`
- Modify: `app/src/components/SessionPanel.tsx`
- Modify: `app/src/components/ui/Dialog.tsx`
- Modify: `app/src/components/LoadState.tsx`

- [ ] **Step 1: ContextMenu — 替换遗留令牌**

```bash
cd E:\A_Project\codemgr
```

在 `ContextMenu.tsx` 中：
- Line 142: `border-base-700` → `border-line`
- Line 148: `hover:bg-base-700` → `hover:bg-surface-raised`
- Line 149: `text-fg-primary` → `text-content-primary`

- [ ] **Step 2: DiagnosticPreview — 替换遗留令牌**

在 `DiagnosticPreview.tsx` 中：
- Line 32: `text-fg-secondary` → `text-content-secondary`
- Line 45: `border-base-600` → `border-line`，`text-fg-secondary` → `text-content-secondary`，`hover:bg-base-700` → `hover:bg-surface-raised`

- [ ] **Step 3: SessionPanel — 替换遗留令牌**

在 `SessionPanel.tsx` 中：
- Line 49: `text-fg-muted` → `text-content-muted`
- Line 74: `text-fg-primary` → `text-content-primary`
- Line 84: `text-fg-muted` → `text-content-muted`
- Line 86: `text-fg-secondary` → `text-content-secondary`

- [ ] **Step 4: Dialog — 替换遗留令牌**

在 `Dialog.tsx` 中：
- Line 102: `text-fg-primary` → `text-content-primary`
- Line 105: `text-fg-secondary` → `text-content-secondary`（如有）

- [ ] **Step 5: LoadState — 替换遗留令牌（临时，Phase 4 会删除此文件）**

在 `LoadState.tsx` 中：
- Line 24-25: `text-fg-muted` → `text-content-muted`
- Line 33: `border-base-600` → `border-line`
- Line 34: `text-fg-muted` → `text-content-muted`
- Line 35: `text-fg-muted` → `text-content-muted`
- Line 45-46: `text-fg-muted` → `text-content-muted`

- [ ] **Step 6: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

Expected: 0 type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ContextMenu.tsx app/src/components/DiagnosticPreview.tsx app/src/components/SessionPanel.tsx app/src/components/ui/Dialog.tsx app/src/components/LoadState.tsx
git commit -m "refactor(app): migrate light components to Aurora tokens"
```

---

### Task 1.2：遗留令牌清除 — 中度组件

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`
- Modify: `app/src/components/PortTable.tsx`

- [ ] **Step 1: ProcessTable — 替换所有遗留令牌**

在 `ProcessTable.tsx` 中，按行号替换：
- Line 84: `text-fg-secondary` → `text-content-secondary`（KIND_COLORS）
- Line 131: `border-base-700/30` → `border-line`，`hover:bg-base-700` → `hover:bg-surface-raised`
- Line 133: `bg-base-700/50` → `bg-surface-raised/50`
- Line 154-155: `bg-base-800` → `bg-surface-panel`，`text-fg-muted` → `text-content-muted`
- Line 161: `bg-base-700` → `bg-surface-raised`
- Line 170: `text-fg-primary` → `text-content-primary`
- Line 177: `text-fg-secondary` → `text-content-secondary`
- Line 187: `text-fg-primary` → `text-content-primary`
- Line 195: `text-fg-primary` → `text-content-primary`
- Line 202: `text-fg-primary` → `text-content-primary`
- Line 207: `text-fg-secondary` → `text-content-secondary`
- Line 210: `text-fg-secondary` → `text-content-secondary`
- Line 214: `text-fg-muted` → `text-content-muted`
- Line 305: `border-base-700/20` → `border-line`
- Line 409: `hover:bg-base-700/30` → `hover:bg-surface-raised/30`
- Line 546: `bg-base-800` → `bg-surface-panel`，`text-fg-muted` → `text-content-muted`

- [ ] **Step 2: PortTable — 替换所有遗留令牌**

在 `PortTable.tsx` 中：
- Line 57: `bg-base-800` → `bg-surface-panel`，`text-fg-muted` → `text-content-muted`
- Line 83: `border-base-700/50` → `border-line`，`hover:bg-base-700` → `hover:bg-surface-raised`
- Line 84: `bg-base-700/60` → `bg-surface-raised/60`
- Line 89: `text-fg-secondary` → `text-content-secondary`
- Line 97: `text-fg-primary` → `text-content-primary`
- Line 98: `text-fg-secondary` → `text-content-secondary`
- Line 99: `text-fg-muted` → `text-content-muted`
- Line 128: `text-fg-muted` → `text-content-muted`

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessTable.tsx app/src/components/PortTable.tsx
git commit -m "refactor(app): migrate ProcessTable + PortTable to Aurora tokens"
```

---

### Task 1.3：遗留令牌清除 — 重度组件

**Files:**
- Modify: `app/src/components/ProcessDetailSidebar.tsx`
- Modify: `app/src/components/LabelRuleEditor.tsx`
- Modify: `app/src/components/SnapshotPanel.tsx`

- [ ] **Step 1: ProcessDetailSidebar — 替换所有遗留令牌（~30 处）**

在 `ProcessDetailSidebar.tsx` 中，全局替换：
- `text-fg-muted` → `text-content-muted`（约 18 处）
- `text-fg-secondary` → `text-content-secondary`（约 5 处）
- `text-fg-primary` → `text-content-primary`（约 1 处）
- `border-base-600` → `border-line`（约 3 处）
- `border-base-700` → `border-line`（约 2 处）
- `bg-base-700` → `bg-surface-raised`（约 1 处）
- `bg-base-900` → `bg-surface-canvas`（约 2 处）
- `hover:bg-base-700` → `hover:bg-surface-raised`（约 1 处）

- [ ] **Step 2: LabelRuleEditor — 替换所有遗留令牌（~30 处）**

在 `LabelRuleEditor.tsx` 中，全局替换：
- `text-fg-muted` → `text-content-muted`（约 12 处）
- `text-fg-secondary` → `text-content-secondary`（约 5 处）
- `text-fg-primary` → `text-content-primary`（约 5 处）
- `border-base-600` → `border-line`（约 8 处）
- `border-base-700` → `border-line`（约 3 处）
- `bg-base-900` → `bg-surface-canvas`（约 8 处）
- `hover:bg-base-700` → `hover:bg-surface-raised`（约 2 处）
- `text-base-900` → `text-surface-canvas`（约 1 处）

- [ ] **Step 3: SnapshotPanel — 替换所有遗留令牌（~15 处）**

在 `SnapshotPanel.tsx` 中：
- `text-fg-muted` → `text-content-muted`（约 8 处）
- `text-fg-secondary` → `text-content-secondary`（约 3 处）
- `border-base-700/*` → `border-line`（约 4 处）
- `hover:bg-base-800/*` → `hover:bg-surface-panel/*`（约 2 处）
- `bg-base-900/*` → `bg-surface-canvas/*`（约 1 处）

- [ ] **Step 4: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 5: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessDetailSidebar.tsx app/src/components/LabelRuleEditor.tsx app/src/components/SnapshotPanel.tsx
git commit -m "refactor(app): migrate heavy components to Aurora tokens"
```

---

### Task 1.4：遗留令牌清除 — PerfPanel + ProcessPanel + 验证清零

**Files:**
- Modify: `app/src/components/PerfPanel.tsx`
- Modify: `app/src/components/ProcessPanel.tsx`

- [ ] **Step 1: PerfPanel — 替换所有遗留令牌（~30 处）**

在 `PerfPanel.tsx` 中，全局替换：
- `text-fg-secondary` → `text-content-secondary`（约 12 处）
- `text-fg-muted` → `text-content-muted`（约 6 处）
- `text-fg-primary` → `text-content-primary`（约 3 处）
- `bg-base-700` → `bg-surface-raised`（约 4 处）
- `bg-base-800` → `bg-surface-panel`（约 3 处）
- `border-base-700` → `border-line`（约 3 处）
- `border-base-700/30` → `border-line`（约 2 处）
- `hover:bg-base-700/30` → `hover:bg-surface-raised/30`（约 1 处）

- [ ] **Step 2: ProcessPanel — 替换遗留令牌（如有遗漏）**

ProcessPanel 大部分已迁移，检查并替换任何残留的 `base-*` / `fg-*` 引用。

- [ ] **Step 3: 验证清零**

```bash
cd E:\A_Project\codemgr
grep -rn "base-[6-8]00\|fg-primary\|fg-secondary\|fg-muted" app/src/ --include="*.tsx" --include="*.ts" | grep -v "tailwind.config" | grep -v "node_modules"
```

Expected: 零结果。如有遗漏，逐一修复。

- [ ] **Step 4: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 5: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/PerfPanel.tsx app/src/components/ProcessPanel.tsx
git commit -m "refactor(app): complete Aurora token migration — zero legacy tokens remaining"
```

---

### Task 1.5：按钮原语统一

**Files:**
- Modify: `app/src/components/ConfirmDialog.tsx`
- Modify: `app/src/components/ProcessPanel.tsx`
- Modify: `app/src/components/ui/Button.tsx`（可能需新增 size）

- [ ] **Step 1: ConfirmDialog — 替换手写按钮为 Button 原语**

在 `ConfirmDialog.tsx` 中，将两个手写 `<button>` 替换为：

取消按钮（原 line 40-47）：
```tsx
import { Button } from './ui/Button';
// ...
<Button variant="secondary" onClick={onCancel} disabled={loading}>
  {cancelLabel ?? '取消'}
</Button>
```

确认按钮（原 line 48-55）：
```tsx
<Button variant="dangerQuiet" onClick={onConfirm} disabled={loading}>
  {confirmLabel ?? '确认'}
</Button>
```

- [ ] **Step 2: ProcessPanel — 替换工具栏手写按钮**

视图切换按钮（原 line 221-225）：
```tsx
<Button variant="ghost" size="xs" onClick={() => setViewMode(viewMode === 'table' ? 'group' : 'table')}>
  {viewMode === 'table' ? <LayoutList size={14} /> : <TableProperties size={14} />}
</Button>
```

Kill all 按钮（原 line 229-234）：
```tsx
<Button variant="dangerQuiet" size="xs" onClick={handleKillAllNode} disabled={...}>
  结束全部 node.exe
</Button>
```

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ConfirmDialog.tsx app/src/components/ProcessPanel.tsx
git commit -m "refactor(app): replace hand-written buttons with Button primitive"
```

---

### Task 1.6：圆角体系统一

**Files:**
- Modify: `app/src/components/Panel.tsx`
- Modify: `app/src/components/ProcessTable.tsx`
- Modify: `app/src/components/ui/Button.tsx`
- Modify: `app/src/components/ui/IconButton.tsx`
- Modify: `app/src/index.css`

- [ ] **Step 1: Panel — `rounded-[6px]` → `rounded-[14px]`**

在 `Panel.tsx` line 23：`rounded-[6px]` → `rounded-[14px]`

- [ ] **Step 2: 搜索输入框 `rounded-md` → `rounded-lg`**

在以下文件中搜索 `rounded-md` 并替换为 `rounded-lg`：
- `ProcessPanel.tsx` 搜索框
- `PortRadar.tsx` 搜索框
- `LabelRuleEditor.tsx` 输入框
- `SnapshotPanel.tsx` 输入框

- [ ] **Step 3: Button/IconButton — `rounded-md` → `rounded-lg`**

在 `Button.tsx` line 51 和 `IconButton.tsx` line 42：`rounded-md` → `rounded-lg`

- [ ] **Step 4: CSS mosaic 控制按钮 — `border-radius: 6px` → `8px`**

在 `index.css` line 487：`border-radius: 6px` → `border-radius: 8px`

- [ ] **Step 5: 验证清零**

```bash
grep -rn "rounded-\[6px\]\|rounded-md" app/src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

Expected: 零结果。

- [ ] **Step 6: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 7: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/Panel.tsx app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx app/src/components/ui/Button.tsx app/src/components/ui/IconButton.tsx app/src/index.css
git commit -m "refactor(app): unify border-radius to 3-tier system (8px/14px/999px)"
```

---

### Task 1.7：表格间距与分割线统一

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`
- Modify: `app/src/components/PortTable.tsx`

- [ ] **Step 1: ProcessTable — 统一单元格内边距**

将所有数据单元格的 `px-2 py-1` 改为 `px-3 py-2`。涉及 lines 153, 186, 194, 201, 207, 210, 214, 219 附近的 td 元素。

复选框列（line 141）：`px-1` → `px-3`。

表头单元格：`px-2 py-2` → `px-3 py-2`（lines 572-622）。

- [ ] **Step 2: ProcessTable + PortTable — 分割线统一**

ProcessTable line 131：`border-line`（已在 Task 1.2 中替换，确认值正确）。
PortTable line 83：同上。

确认两个表格的行分割线都是 `border-line`（即 `rgba(255,255,255,0.07)`）。

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessTable.tsx app/src/components/PortTable.tsx
git commit -m "refactor(app): unify table cell padding (px-3 py-2) and divider opacity"
```

---

### Task 1.8：面板微浮阴影

**Files:**
- Modify: `app/src/index.css`

- [ ] **Step 1: 为 .glass 添加 elevation shadow**

在 `index.css` 的 `.glass` 规则中（line 116-121），添加：

```css
.glass {
  background: var(--bg-panel);
  backdrop-filter: blur(20px) saturate(1.15);
  -webkit-backdrop-filter: blur(20px) saturate(1.15);
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
}
```

- [ ] **Step 2: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/index.css
git commit -m "feat(app): add subtle elevation shadow to glass panels"
```

---

### Task 1.9：布局常量 CSS 变量化

**Files:**
- Modify: `app/src/index.css`

- [ ] **Step 1: 在 :root 中添加布局变量**

在 `:root` 块中（line 12 附近），添加：

```css
--sidebar-width: 180px;
--topbar-height: 40px;
--brand-mark-size: 22px;
```

- [ ] **Step 2: 替换所有引用处**

在 `index.css` 中：
- Line 199: `grid-template-columns: 180px` → `grid-template-columns: var(--sidebar-width)`
- Line 221: `height: 40px; flex: 0 0 40px` → `height: var(--topbar-height); flex: 0 0 var(--topbar-height)`
- Line 229: `width: 22px; height: 22px; flex: 0 0 22px` → `width: var(--brand-mark-size); height: var(--brand-mark-size); flex: 0 0 var(--brand-mark-size)`
- Line 247: `grid-template-rows: 40px` → `grid-template-rows: var(--topbar-height)`

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/index.css
git commit -m "refactor(app): extract layout constants to CSS custom properties"
```

---

## Phase 2：交互一致性

### Task 2.1：Hover 过渡统一

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`
- Modify: `app/src/components/PortTable.tsx`
- Modify: `app/src/components/ContextMenu.tsx`

- [ ] **Step 1: ProcessTable 行 — 添加过渡**

在 `ProcessTable.tsx` line 131 的 tr className 中，添加 `transition-colors duration-150 ease-out`。

展开/折叠箭头（line 164 附近）：添加 `transition-colors duration-150`。

排序表头（lines 572-622）：添加 `transition-colors duration-150`。

- [ ] **Step 2: PortTable 行 — 添加过渡**

在 `PortTable.tsx` line 83 的 tr className 中，添加 `transition-colors duration-150 ease-out`。

- [ ] **Step 3: ContextMenu 项目 — 添加过渡**

在 `ContextMenu.tsx` line 148 的菜单项 className 中，添加 `transition-colors duration-150 ease-out`。

- [ ] **Step 4: 验证**

```bash
cd E:\A_Project\codemgr
grep -rn "hover:bg-\|hover:text-" app/src/components/ --include="*.tsx" | grep -v "transition" | grep -v "Button.tsx\|IconButton.tsx"
```

Expected: 零结果（所有 hover 都有 transition）。

- [ ] **Step 5: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessTable.tsx app/src/components/PortTable.tsx app/src/components/ContextMenu.tsx
git commit -m "fix(app): add transition-colors to all hoverable elements"
```

---

### Task 2.2：焦点环样式统一

**Files:**
- Modify: `app/src/components/ProcessTable.tsx`
- Modify: `app/src/components/PortTable.tsx`
- Modify: `app/src/components/LabelRuleEditor.tsx`
- Modify: `app/src/components/PollIntervalSelect.tsx`（如存在）
- Modify: `app/src/components/ProcessPanel.tsx`
- Modify: `app/src/components/PortRadar.tsx`
- Modify: `app/src/components/workspace/WorkspaceSidebar.tsx`

- [ ] **Step 1: 表格行焦点环 — 统一到内环模式**

ProcessTable line 134: `ring-1 ring-inset ring-accent/60` → `ring-1 ring-inset ring-focus/60`
PortTable line 85: 同上

排序表头 `focus:ring-1 focus:ring-inset focus:ring-accent/60` → `focus:ring-1 focus:ring-inset focus:ring-focus/60`

- [ ] **Step 2: 输入框焦点环 — 统一到外环模式**

ProcessPanel 搜索框（line 204）：`focus:border-focus/60` → `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas`

PortRadar 搜索框（line 72）：同上。

LabelRuleEditor 输入框（lines 244-271）：`focus:border-accent` → 外环模式。

PollIntervalSelect（如存在）：`focus:border-accent/50` → 外环模式。

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessTable.tsx app/src/components/PortTable.tsx app/src/components/LabelRuleEditor.tsx app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx
git commit -m "fix(app): unify focus ring to 2 patterns (outer ring for forms, inner ring for lists)"
```

---

### Task 2.3：毛玻璃材质统一

**Files:**
- Modify: `app/src/index.css`

- [ ] **Step 1: 侧栏 — 统一 blur/saturate 参数**

在 `index.css` line 215 附近，`.workspace-sidebar` 中：
`backdrop-filter: blur(24px) saturate(1.12)` → `backdrop-filter: blur(20px) saturate(1.15)`
`-webkit-backdrop-filter: blur(24px) saturate(1.12)` → `-webkit-backdrop-filter: blur(20px) saturate(1.15)`

- [ ] **Step 2: 顶栏 — 补上 blur**

在 `index.css` line 258 附近，`.workspace-topbar` 中，添加：
```css
backdrop-filter: blur(20px) saturate(1.15);
-webkit-backdrop-filter: blur(20px) saturate(1.15);
```

- [ ] **Step 3: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/index.css
git commit -m "fix(app): unify glass blur/saturate params across sidebar, topbar, and panels"
```

---

## Phase 3：Toast 通知系统

### Task 3.1：Toast Store

**Files:**
- Create: `app/src/store/toastStore.ts`

- [ ] **Step 1: 创建 toastStore**

```typescript
import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => void;
  removeToast: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++counter}`;
    const newToast: Toast = { ...toast, id, createdAt: Date.now() };
    set((state) => {
      const toasts = [newToast, ...state.toasts];
      // 最多保留 3 条
      if (toasts.length > 3) toasts.pop();
      return { toasts };
    });
    // 自动消失 4 秒
    setTimeout(() => {
      get().removeToast(id);
    }, 4000);
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
```

- [ ] **Step 2: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/store/toastStore.ts
git commit -m "feat(app): add toastStore for notification system"
```

---

### Task 3.2：Toast 组件 + ToastHost

**Files:**
- Create: `app/src/components/Toast.tsx`
- Create: `app/src/components/ToastHost.tsx`
- Modify: `app/src/main.tsx`（挂载 ToastHost）

- [ ] **Step 1: 创建 Toast 组件**

```tsx
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import type { Toast as ToastData } from '../store/toastStore';
import { useToastStore } from '../store/toastStore';

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const;

const BORDER_COLORS = {
  success: 'border-l-success',
  error: 'border-l-danger',
  info: 'border-l-accent',
} as const;

export function Toast({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const Icon = ICONS[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`
        glass-elevated flex items-center gap-3 rounded-lg border-l-2 ${BORDER_COLORS[toast.type]}
        px-4 py-3 text-sm text-content-primary shadow-2xl
        animate-[slideIn_200ms_ease-out]
      `}
      onMouseEnter={(e) => {
        // hover 暂停自动消失（通过 data 属性标记，由 ToastHost 处理）
        e.currentTarget.dataset.paused = 'true';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.dataset.paused = 'false';
      }}
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1 truncate">{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-content-muted hover:text-content-primary transition-colors duration-150"
        aria-label="关闭通知"
      >
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 创建 ToastHost 容器**

```tsx
import { createPortal } from 'react-dom';
import { useToastStore } from '../store/toastStore';
import { Toast } from './Toast';

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="fixed right-4 z-[9999] flex flex-col gap-2"
      style={{ top: 'calc(var(--topbar-height) + 12px)' }}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: 在 main.tsx 中挂载 ToastHost**

在 `app/src/main.tsx` 的 `<App />` 后添加 `<ToastHost />`：

```tsx
import { ToastHost } from './components/ToastHost';
// ...
<StrictMode>
  <App />
  <ToastHost />
</StrictMode>
```

- [ ] **Step 4: 添加 slideIn 动画到 index.css**

在 `index.css` 中添加：

```css
@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

- [ ] **Step 5: 类型检查**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/Toast.tsx app/src/components/ToastHost.tsx app/src/main.tsx app/src/index.css
git commit -m "feat(app): Toast + ToastHost components with slide-in animation"
```

---

### Task 3.3：替换 alert() — ProcessPanel

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx`

- [ ] **Step 1: 导入 toastStore**

在文件顶部添加：
```typescript
import { useToastStore } from '../store/toastStore';
```

在组件内部获取 addToast：
```typescript
const addToast = useToastStore((s) => s.addToast);
```

- [ ] **Step 2: 替换所有 alert() 调用**

逐一替换（共 14 处）：

| 行号 | 原 alert() | 替换为 |
|------|-----------|--------|
| 74 | `alert('结束失败：受保护进程...')` | `addToast({ type: 'error', message: '结束失败：受保护进程、权限不足或进程已退出' })` |
| 78 | `` alert(`结束失败：${String(e)}`) `` | `addToast({ type: 'error', message: `结束失败：${String(e)}` })` |
| 92 | `alert('未结束任何进程...')` | `addToast({ type: 'info', message: '未结束任何进程：可能均为受保护进程' })` |
| 95 | `` alert(`已结束 ${killed}/${targets.length}...`) `` | `addToast({ type: 'success', message: `已结束 ${killed}/${targets.length} 个进程` })` |
| 98 | `` alert(`已结束 ${killed} 个进程`) `` | `addToast({ type: 'success', message: `已结束 ${killed} 个进程` })` |
| 102 | `` alert(`批量结束失败：${String(e)}`) `` | `addToast({ type: 'error', message: `批量结束失败：${String(e)}` })` |
| 115-117 | kill all node 结果 | `addToast({ type: killed === 0 ? 'info' : 'success', message: ... })` |
| 120 | `` alert(`结束 node.exe 失败...`) `` | `addToast({ type: 'error', message: ... })` |
| 135 | 组内未结束 | `addToast({ type: 'info', message: ... })` |
| 137 | 组内部分结束 | `addToast({ type: 'success', message: ... })` |
| 139 | 组内全部结束 | `addToast({ type: 'success', message: ... })` |
| 142 | 组结束失败 | `addToast({ type: 'error', message: ... })` |
| 156-157 | 进程树结束 | `addToast({ type: killed === 0 ? 'info' : 'success', message: ... })` |
| 160 | 进程树失败 | `addToast({ type: 'error', message: ... })` |

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessPanel.tsx
git commit -m "feat(app): replace ProcessPanel alert() with toast notifications"
```

---

### Task 3.4：替换 alert() — 其余组件

**Files:**
- Modify: `app/src/components/PortRadar.tsx`
- Modify: `app/src/components/LabelRuleEditor.tsx`
- Modify: `app/src/components/SessionPanel.tsx`
- Modify: `app/src/components/SnapshotPanel.tsx`

- [ ] **Step 1: PortRadar — 替换 2 处 alert()**

导入 `useToastStore`，替换 line 32 和 37。

- [ ] **Step 2: LabelRuleEditor — 替换 5 处 alert()**

导入 `useToastStore`，替换 lines 128, 130, 141, 150, 153。

- [ ] **Step 3: SessionPanel — 替换 2 处 alert()**

导入 `useToastStore`，替换 lines 34 和 39。

- [ ] **Step 4: SnapshotPanel — 替换 7 处 alert()**

导入 `useToastStore`，替换 lines 155, 163, 176, 215, 217, 219, 225。

- [ ] **Step 5: 验证清零**

```bash
grep -rn "alert(" app/src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules\|role=\|aria-\|test\|spec"
```

Expected: 零结果（除测试文件中的 mock）。

- [ ] **Step 6: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 7: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/PortRadar.tsx app/src/components/LabelRuleEditor.tsx app/src/components/SessionPanel.tsx app/src/components/SnapshotPanel.tsx
git commit -m "feat(app): replace all remaining alert() with toast notifications"
```

---

### Task 3.5：Toast 测试

**Files:**
- Create: `app/tests/toastStore.test.ts`

- [ ] **Step 1: 编写 toastStore 测试**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useToastStore } from '../src/store/toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  it('adds a toast with auto-generated id', () => {
    useToastStore.getState().addToast({ type: 'success', message: 'done' });
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('done');
    expect(toasts[0].id).toMatch(/^toast-/);
  });

  it('removes a toast by id', () => {
    useToastStore.getState().addToast({ type: 'info', message: 'hi' });
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-removes after 4 seconds', () => {
    useToastStore.getState().addToast({ type: 'success', message: 'gone soon' });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps max 3 toasts', () => {
    for (let i = 0; i < 5; i++) {
      useToastStore.getState().addToast({ type: 'info', message: `msg ${i}` });
    }
    expect(useToastStore.getState().toasts).toHaveLength(3);
    // 最新的在前
    expect(useToastStore.getState().toasts[0].message).toBe('msg 4');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd E:\A_Project\codemgr\app && pnpm vitest run tests/toastStore.test.ts
```

Expected: 4/4 PASS。

- [ ] **Step 3: Commit**

```bash
cd E:\A_Project\codemgr
git add app/tests/toastStore.test.ts
git commit -m "test(app): add toastStore tests"
```

---

## Phase 4：PerfPanel 迁移 + LoadState 淘汰

### Task 4.1：PerfPanel 图表卡片升级为毛玻璃

**Files:**
- Modify: `app/src/components/PerfPanel.tsx`

- [ ] **Step 1: 图表卡片 — bg-surface-panel → glass 类**

PerfPanel 中 3 个图表卡片区域（lines 245, 291, 334），将：
```
border border-line rounded-lg bg-surface-panel p-4
```
改为：
```
glass rounded-[14px] p-4
```

（注意：Phase 1 Task 1.4 已替换遗留令牌，此处是材质升级。）

- [ ] **Step 2: 子标签栏升级**

子标签栏容器：添加 `glass` 类（如果当前是纯色背景）。

- [ ] **Step 3: 类型检查 + 测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/PerfPanel.tsx
git commit -m "feat(app): upgrade PerfPanel cards to glass material"
```

---

### Task 4.2：LoadState 淘汰 → StateView 统一

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx`
- Modify: `app/src/components/PortRadar.tsx`
- Modify: `app/src/components/PerfPanel.tsx`
- Modify: `app/src/components/SessionPanel.tsx`
- Delete: `app/src/components/LoadState.tsx`
- Delete: `app/tests/LoadState.test.tsx`（如存在）

- [ ] **Step 1: ProcessPanel — LoadState → StateView**

替换 import：
```typescript
// 删除
import { LoadState } from './LoadState';
// 添加
import { StateView } from './ui/StateView';
```

替换 JSX 中的 `<LoadState ... />` 为 `<StateView state={...} title={...} />`。

- [ ] **Step 2: PortRadar — LoadState → StateView**

同上模式。

- [ ] **Step 3: PerfPanel — LoadState → StateView**

同上模式。

- [ ] **Step 4: SessionPanel — LoadState → StateView**

同上模式。

- [ ] **Step 5: 验证无 LoadState 引用**

```bash
grep -rn "LoadState" app/src/ --include="*.tsx" --include="*.ts"
```

Expected: 零结果。

- [ ] **Step 6: 删除 LoadState.tsx 和测试**

```bash
rm app/src/components/LoadState.tsx
rm app/tests/LoadState.test.tsx 2>/dev/null  # 如存在
```

- [ ] **Step 7: 类型检查 + 全量测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

Expected: 0 type errors, all tests pass（LoadState 测试已删除，不计入）。

- [ ] **Step 8: Commit**

```bash
cd E:\A_Project\codemgr
git add app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx app/src/components/PerfPanel.tsx app/src/components/SessionPanel.tsx
git rm app/src/components/LoadState.tsx
git commit -m "refactor(app): replace LoadState with StateView, delete LoadState"
```

---

### Task 4.3：遗留别名清理 + 最终验证

**Files:**
- Modify: `app/tailwind.config.ts`

- [ ] **Step 1: 删除兼容别名**

在 `tailwind.config.ts` 中，删除 "Compatibility mappings" 部分（lines 31-41）：

```typescript
// 删除以下行：
'base-900': 'var(--surface-canvas)',
'base-800': 'var(--surface-panel)',
'base-700': 'var(--surface-raised)',
'base-600': 'var(--line)',
'fg-primary': 'var(--content-primary)',
'fg-secondary': 'var(--content-secondary)',
'fg-muted': 'var(--content-muted)',
```

- [ ] **Step 2: 验证无遗留引用**

```bash
grep -rn "base-[6-9]00\|fg-primary\|fg-secondary\|fg-muted" app/src/ --include="*.tsx" --include="*.ts" | grep -v "tailwind.config"
```

Expected: 零结果。

- [ ] **Step 3: 全量测试**

```bash
cd E:\A_Project\codemgr\app && pnpm typecheck && pnpm vitest run
```

Expected: 0 type errors, all tests pass。

- [ ] **Step 4: Commit**

```bash
cd E:\A_Project\codemgr
git add app/tailwind.config.ts
git commit -m "refactor(app): remove legacy token aliases from tailwind config"
```

---

## 最终验证

- [ ] **全量回归**

```bash
cd E:\A_Project\codemgr && pnpm test:native && cd app && pnpm vitest run && pnpm typecheck
```

Expected: native 49/49 + app 全部 PASS + 0 type errors。

- [ ] **视觉检查清单**

暗色主题下：
- [ ] 所有面板材质一致（blur 20px, saturate 1.15）
- [ ] 非聚焦面板有微浮阴影
- [ ] 表格行 hover 有 150ms 过渡
- [ ] 焦点环只有 2 种模式
- [ ] 无 emoji、无原生 alert()
- [ ] Toast 从右上角滑入，毛玻璃材质
- [ ] PerfPanel 与其他面板视觉一致

亮色主题下：
- [ ] 同上所有项
