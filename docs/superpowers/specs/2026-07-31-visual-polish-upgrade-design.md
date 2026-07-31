# CodeMgr 视觉精致度升级 — 设计 Spec

> 版本: v1.0 | 日期: 2026-07-31 | 状态: 设计锁定
> 范围：前端 UI/UX 视觉一致性与精致度，不涉及功能变更。
> 方法：基于 Aurora UI v1.2（Linear 纪律 × Apple 毛玻璃）的系统性补全与统一。
> 前置条件：所有改动在 `feat/desktop-workbench` 分支进行，每个 Phase 独立 PR 合入 main。

---

## 0. 问题陈述

当前 Aurora UI v1.2 的设计系统已建立（语义令牌、毛玻璃材质、Siri 辉光），但组件层面存在 **系统性不一致**：

1. **令牌双轨制**：15+ 个组件混用旧版 `base-600/700/800`、`fg-primary/secondary` 与新版 `surface-*`、`content-*` 令牌。PerfPanel 整面板未迁移。
2. **交互碎片化**：4 种焦点环模式、3 种 spinner 实现、hover 过渡有的有有的无。
3. **毛玻璃材质不一致**：侧栏/面板/顶栏的 blur/saturate 参数各不相同，顶栏无 blur。
4. **反馈路径断裂**：20+ 处使用原生 `alert()`，与 Aurora 视觉语言完全割裂。
5. **组件复用不足**：6+ 个手写 `<button>` 绕过 Button 原语，LoadState 用 emoji 而非已有的 StateView。
6. **间距/圆角/阴影不统一**：表格内边距、行分割线、圆角值、阴影使用各处不一致。

---

## 1. Phase 1：基础设施清理

### 1.1 遗留令牌全面清除

全局搜索替换，消灭所有 `base-*` / `fg-*` 旧令牌引用：

| 旧令牌 | 新令牌 | 说明 |
|--------|--------|------|
| `bg-base-600` | `bg-surface-overlay` | 最亮表面层 |
| `bg-base-700` | `bg-surface-raised` | 浮层 |
| `bg-base-800` | `bg-surface-panel` | 面板 |
| `text-fg-primary` | `text-content-primary` | 主文字 |
| `text-fg-secondary` | `text-content-secondary` | 次文字 |
| `text-fg-muted` | `text-content-muted` | 弱文字 |
| `border-base-600` | `border-line` | 边框 |
| `border-base-700` | `border-line` | 边框（统一透明度） |
| `border-base-700/30` | `border-line` | 分割线统一 7% |
| `border-base-700/50` | `border-line` | 同上 |
| `ring-accent/60` | `ring-focus/60` | 焦点环用 focus 令牌 |

**受影响组件**（预计）：ProcessTable、PortTable、PerfPanel、ProcessDetailSidebar、ProcessPanel、PortRadar、ContextMenu、Dialog、LoadState、DiagnosticPreview、SnapshotPanel、LabelRuleEditor、PollIntervalSelect。

**验证**：替换后 `grep -rn "base-[6-8]00\|fg-primary\|fg-secondary\|fg-muted" app/src/` 结果为空。

### 1.2 按钮原语统一

将所有手写 `<button>` 替换为 `<Button>` / `<IconButton>` 原语：

| 位置 | 当前写法 | 目标 |
|------|---------|------|
| `ConfirmDialog.tsx` 取消按钮 | 手写 secondary 样式 | `<Button variant="secondary">` |
| `ConfirmDialog.tsx` 确认按钮 | 手写 danger 样式 | `<Button variant="dangerQuiet">` |
| `ProcessPanel.tsx` 视图切换 | 手写 secondary | `<Button variant="ghost" size="xs">` |
| `ProcessPanel.tsx` kill all | 手写 danger | `<Button variant="dangerQuiet" size="xs">` |
| `ProcessPanel.tsx` 详情栏操作按钮 | 手写样式 | 对应 `<Button>` 变体 |
| `PortRadar.tsx` 工具栏按钮 | 手写样式 | 对应 `<Button>` 变体 |

**验证**：`grep -rn "<button " app/src/components/ | grep -v "Button.tsx"` 仅保留 Button.tsx 内部的原生 button。

### 1.3 圆角体系统一

建立 3 级圆角体系，消灭所有任意值：

| 级别 | Tailwind | 值 | 用途 |
|------|----------|-----|------|
| 控件 | `rounded-lg` | 8px | 按钮、输入框、下拉、ContextMenu、表格行展开区 |
| 面板 | `rounded-[14px]` | 14px | Panel、Dialog、LabelRuleEditor 模态、图表卡片 |
| 徽章 | `rounded-full` | 999px | Badge、标签 pill |

**关键改动**：
- `Panel.tsx`：`rounded-[6px]` → `rounded-[14px]`
- `ProcessTable.tsx` kill 按钮：`rounded-lg` 保持（已是控件级）
- `PollIntervalSelect.tsx`：`rounded-lg` 保持
- 搜索输入框：`rounded-md`(6px) → `rounded-lg`(8px)
- 确认 `rounded-md` 不再出现于任何组件

**验证**：`grep -rn "rounded-\[6px\]\|rounded-md" app/src/` 结果为空。

### 1.4 表格间距与分割线统一

| 项目 | ProcessTable 当前 | PortTable 当前 | 统一目标 |
|------|-------------------|----------------|---------|
| 数据单元格水平内边距 | `px-2` | `px-3` | `px-3` |
| 数据单元格垂直内边距 | `py-1` | `py-2` | `py-2` |
| 表头单元格 | `px-2 py-2` | `px-3 py-2` | `px-3 py-2` |
| 行分割线 | `border-base-700/30` | `border-base-700/50` | `border-line`（7% 白） |
| 空态单元格 | `px-3 py-8` | `px-3 py-8` | `px-3 py-8`（已一致） |
| 复选框列 | `px-1` | — | `px-3`（与其他列对齐） |

### 1.5 面板微浮阴影

为 `.glass` 类添加极微妙的 elevation shadow，为非聚焦面板提供层级感知：

```css
.glass {
  /* 现有属性保持不变 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
}
```

- 聚焦面板 `.panel-active` 的辉光描边 box-shadow 会覆盖此值，不受影响。
- 亮色模式下阴影略加强：`0 1px 3px rgba(0, 0, 0, 0.08)`。

### 1.6 布局常量 CSS 变量化

提取为 CSS 自定义属性：

```css
:root {
  --sidebar-width: 180px;
  --topbar-height: 40px;
  --brand-mark-size: 22px;
}
```

替换 `index.css` 中所有引用处：
- `.workspace-shell` 的 `grid-template-columns: 180px` → `var(--sidebar-width)`
- `.workspace-topbar` 的 `grid-template-rows: 40px` → `var(--topbar-height)`
- 品牌区域 `height: 40px` → `var(--topbar-height)`
- 品牌标记 `width/height: 22px` → `var(--brand-mark-size)`

---

## 2. Phase 2：交互一致性

### 2.1 Hover 过渡统一

为所有可交互元素添加统一过渡 `transition-colors duration-150 ease-out`：

| 元素 | 文件 | 改动 |
|------|------|------|
| ProcessTable 数据行 | `ProcessTable.tsx` | + `transition-colors duration-150 ease-out` |
| PortTable 数据行 | `PortTable.tsx` | + `transition-colors duration-150 ease-out` |
| ContextMenu 菜单项 | `ContextMenu.tsx` | + `transition-colors duration-150 ease-out` |
| 展开/折叠箭头 | `ProcessTable.tsx` | + `transition-colors duration-150` |
| 表格排序头 | `ProcessTable.tsx` | + `transition-colors duration-150` |

**验证**：所有含 `hover:` 的元素同时含 `transition`。

### 2.2 焦点环样式统一

收敛为 2 种标准模式：

**外环模式**（表单控件）：
```
focus-visible:ring-2 focus-visible:ring-focus/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas
```
适用：Button、IconButton、所有 `<input>`、所有 `<select>`、PollIntervalSelect、WorkspaceSidebar select。

**内环模式**（列表/表格行）：
```
focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus/60
```
适用：表格行、ContextMenu 项、排序表头。

**关键改动**：
- `LabelRuleEditor.tsx` 输入框：`focus:border-accent` → 外环模式
- `PollIntervalSelect.tsx`：`focus:border-accent/50` → 外环模式
- `ProcessPanel.tsx` 搜索框：`focus:border-focus/60` → 外环模式
- `PortRadar.tsx` 搜索框：同上
- `ProcessTable.tsx` 排序头：`ring-accent/60` → `ring-focus/60`（用 focus 令牌）
- `WorkspaceSidebar.tsx` select：已有 `ring-2 ring-focus/70`，补充 `ring-offset`

### 2.3 毛玻璃材质统一

| 区域 | 当前参数 | 目标参数 |
|------|---------|---------|
| 面板 `.glass` | `blur(20px) saturate(1.15)` | 保持不变（基准） |
| 侧栏 `.workspace-sidebar` | `blur(24px) saturate(1.12)` | `blur(20px) saturate(1.15)` |
| 顶栏 `.workspace-topbar` | 无 blur | + `backdrop-filter: blur(20px) saturate(1.15)` |
| mosaic 工具栏 | CSS 手写 | 重用 `.glass-elevated` 类 |

---

## 3. Phase 3：Toast 通知系统

### 3.1 组件设计

**视觉规格**：
- 位置：右上角，距顶栏下方 12px，距右边缘 16px
- 材质：`.glass-elevated`（毛玻璃浮层）
- 圆角：8px（控件级）
- 宽度：`max-w-sm`（320px）
- 最大高度：单行文本，不换行，溢出 ellipsis
- 左侧：lucide 图标（16px）
- 右侧：× 关闭按钮

**类型映射**：

| 类型 | 图标 | 左边框色 | 用途 |
|------|------|---------|------|
| `success` | `CheckCircle16` | `2px solid var(--success)` | 操作成功 |
| `error` | `AlertCircle16` | `2px solid var(--danger)` | 操作失败 |
| `info` | `Info16` | `2px solid var(--accent)` | 信息提示 |

**动画**：
- 进入：`translateX(100%) → translateX(0)` + `opacity(0) → opacity(1)`，200ms ease-out
- 退出：反向，200ms ease-out
- `prefers-reduced-motion`：无动画，直接出现/消失

**行为**：
- 自动消失：4 秒（hover 暂停计时）
- 手动关闭：点击 ×
- 堆叠：最多 3 条可见，新消息从上插入，旧消息下移
- 超过 3 条：最早的消息立即移除

### 3.2 实现架构

| 文件 | 职责 |
|------|------|
| `app/src/store/toastStore.ts` | Zustand store：`toasts: Toast[]`、`addToast()`、`removeToast()`、`dismissOldest()` |
| `app/src/components/Toast.tsx` | 单条 Toast 组件 |
| `app/src/components/ToastHost.tsx` | 容器组件，portal 到 `document.body`，订阅 toastStore，管理堆叠与动画 |

**Toast 类型定义**：
```typescript
interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  createdAt: number;
}
```

### 3.3 alert() 替换清单

| 组件 | 替换数 | 典型场景 |
|------|--------|---------|
| `ProcessPanel.tsx` | 11 | kill 成功/失败、批量操作反馈 |
| `PortRadar.tsx` | 2 | kill 成功/失败 |
| `LabelRuleEditor.tsx` | 5 | 规则导入/导出/删除/保存 |
| `SessionPanel.tsx` | 2 | 快照保存/删除 |

替换模式：
```typescript
// 之前
alert('已结束进程');

// 之后
import { useToastStore } from '../store/toastStore';
const addToast = useToastStore(s => s.addToast);
addToast({ type: 'success', message: '已结束进程' });
```

---

## 4. Phase 4：PerfPanel 迁移 + LoadState 淘汰

### 4.1 PerfPanel Aurora 迁移

全面替换 PerfPanel 中的遗留令牌：

| 区域 | 当前 | 目标 |
|------|------|------|
| 子标签栏 | `bg-base-800 border-base-700` | `bg-surface-panel border-line` |
| 子标签按钮（选中） | `bg-base-700 text-fg-primary` | `bg-surface-raised text-content-primary` |
| 子标签按钮（未选中） | `text-fg-secondary hover:text-fg-primary` | `text-content-secondary hover:text-content-primary` |
| 图表卡片 | `bg-base-800 rounded-lg` | `glass rounded-[14px]` |
| 指标数值 | `text-fg-primary` | `text-content-primary` |
| 指标标签 | `text-fg-secondary` | `text-content-secondary` |
| 分割线 | `border-base-700` | `border-line` |
| 指标卡片背景 | `bg-base-700` | `bg-surface-raised` |

图表区域（Recharts）不改——配色已是 `accent-data` Aurora 令牌。

### 4.2 LoadState 淘汰 → StateView 统一

**StateView 组件**（已存在，`app/src/components/ui/StateView.tsx`）支持 3 种状态：

| state | 图标 | 用途 |
|-------|------|------|
| `loading` | `<LoaderCircle>` (SVG spinner) | 数据加载中 |
| `error` | `<AlertCircle>` | 加载失败 |
| `empty` | `<Inbox>` | 无数据 |

**迁移清单**：

| 文件 | 当前 | 目标 |
|------|------|------|
| `ProcessPanel.tsx` | `<LoadState />` | `<StateView state={...} message={...} />` |
| `PortRadar.tsx` | `<LoadState />` | `<StateView state={...} message={...} />` |
| `PerfPanel.tsx` | `<LoadState />` | `<StateView state={...} message={...} />` |
| `SessionPanel.tsx` | `<LoadState />` | `<StateView state={...} message={...} />` |
| `SnapshotPanel.tsx` | `<LoadState />` | `<StateView state={...} message={...} />` |

**最终**：删除 `app/src/components/LoadState.tsx`，删除 `LoadState.test.tsx`。

---

## 5. 验收标准

每个 Phase 完成后必须满足：

1. **类型检查**：`cd app && pnpm typecheck` 零错误
2. **测试**：`cd app && pnpm vitest run` 全部通过（现有测试不回归）
3. **视觉验证**：
   - Phase 1：`grep` 消灭所有遗留令牌/任意圆角值
   - Phase 2：所有 hover 有 transition，焦点环只有 2 种模式
   - Phase 3：所有 `alert()` 已替换，Toast 从右上角滑入
   - Phase 4：PerfPanel 与其他面板视觉一致，无 emoji，无 LoadState 引用
4. **暗色/亮色双主题**：所有改动在两种主题下均正确
5. **无障碍**：`prefers-reduced-motion` 下无动画，焦点环可见

---

## 6. 不做的事

- 不改功能逻辑（只改视觉呈现）
- 不改 Recharts 图表配色
- 不改 native 采集层
- 不改 IPC 通道
- 不新增功能面板
- 不做响应式布局调整（那是 Phase 6 聚焦工作区的范畴）
