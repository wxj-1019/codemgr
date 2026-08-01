# 显示层一致性收口（Display Consistency Sweep）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复合并后显示层漂移：56 处失效 `text-fg-*` 令牌 + 6 处 `bg-base-*`/`border-base-*` + 表头/行高/横幅/空态/圆角/按钮/图标一致性统一到 Aurora 设计系统规范。

**Architecture:** 纯 class 级视觉修复，无逻辑改动、无新组件。分 6 个主题任务 + 1 个验证任务，每任务独立 commit。验证策略：grep 源码/构建产物零残留 + 全量测试回归（空态改 StateView 时保留原文案，sessionPanel.test.tsx 断言文案正则因此继续通过）。

**Tech Stack:** React 18 + Tailwind（语义令牌 surface/content/line/focus/accent/warn/danger）。不碰 native。

**执行前提：** 在 `main`（9fa07f2）上建分支 `git checkout -b feat/display-consistency`。所有提交用精确 `git add <file>`，**绝不 `git add -A`**。文件均为 UTF-8 中文，编辑用 Read/Edit 工具（终端 grep 输出中文可能乱码，用 `grep -n "pattern" file` 拿行号后用 Read 看）。

**全局映射表（Task 1-6 反复使用）：**

| 失效/漂移值 | 替换 |
|---|---|
| `text-fg-primary` | `text-content-primary` |
| `text-fg-secondary` | `text-content-secondary` |
| `text-fg-muted` | `text-content-muted` |
| `bg-base-700` | `bg-surface-overlay` |
| `bg-base-800` | `bg-surface-raised` |
| `bg-base-900` | `bg-surface-panel` |
| `border-base-700` | `border-line` |
| `ring-cyan-400/70` | `ring-accent/60` |
| `bg-amber-500/[0.14] text-amber-400` | `bg-warn/[0.14] text-warn` |
| `bg-slate-600/[0.14] text-content-secondary` | `bg-surface-raised text-content-secondary` |
| `text-red-400` | `text-danger` |
| `bg-black/60`（无 blur） | `bg-black/40 backdrop-blur-sm` |
| `rounded-[18px]` / `rounded-[20px]` / `rounded-2xl`（浮层） | `rounded-[14px]` |
| `rounded-md`（控件） | `rounded-lg` |

**测试命令（app 目录）：** `npx vitest run <file>`；全量 `pnpm vitest run`；`pnpm typecheck`。

---

### Task 1: 主表文件失效令牌修复（4 文件）

**Files:**
- Modify: `app/src/components/StartupPanel.tsx`（fg 6 处）
- Modify: `app/src/components/ProcessTable.tsx`（fg 10 处）
- Modify: `app/src/components/PortTable.tsx`（fg 1 处）
- Modify: `app/src/components/ProjectGroupView.tsx`（fg 16 处）

- [ ] **Step 1: 逐文件替换**（用 Edit 逐处或整段替换；映射见全局表）：

StartupPanel.tsx 全部 `text-fg-*` → `text-content-*`（行 37/52/54/55/60/76 附近，含 thead 行 37 与空态行 76）。
ProcessTable.tsx 全部 `text-fg-*` → `text-content-*`（行 158/164/178/186/194/199/202/206/563/663 附近）。
PortTable.tsx 行 86 thead 的 `text-fg-muted` → `text-content-muted`。
ProjectGroupView.tsx 全部 `text-fg-*` → `text-content-*`（行 64/67/70/72/79/82/161/173/176/179/182/186/488/514/527/584 附近）。

- [ ] **Step 2: grep 验证**：`grep -rn "text-fg-" app/src/components/StartupPanel.tsx app/src/components/ProcessTable.tsx app/src/components/PortTable.tsx app/src/components/ProjectGroupView.tsx` → 无输出

- [ ] **Step 3: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/processPanelMultiSelect.test.tsx tests/portRadar.test.tsx tests/workspaceNavigation.test.tsx`
Expected: typecheck 干净、测试 PASS

- [ ] **Step 4: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/StartupPanel.tsx app/src/components/ProcessTable.tsx app/src/components/PortTable.tsx app/src/components/ProjectGroupView.tsx
git commit -m "fix(app): repair dead fg-* text tokens in main tables"
```

---

### Task 2: 其余文件失效令牌 + 硬编码色修复（7 文件）

**Files:**
- Modify: `app/src/components/RunLogView.tsx`（fg 3 + bg-base 3 处）
- Modify: `app/src/components/RunProfilesPanel.tsx`（fg 3 处）
- Modify: `app/src/components/ToastHost.tsx`（fg 1 处）
- Modify: `app/src/components/ContextMenu.tsx`（fg 1 处）
- Modify: `app/src/components/EnvDiffDialog.tsx`（fg 12 + bg-base/border-base 2 处）
- Modify: `app/src/components/ErrorBoundary.tsx`（fg 1 处）
- Modify: `app/src/components/ProcessDetailSidebar.tsx`（text-red-400 1 处）

- [ ] **Step 1: 逐文件替换**（映射见全局表）：

RunLogView.tsx：行 64 `border border-base-700 bg-base-900` → `border border-line bg-surface-panel`；行 74 `hover:bg-base-700 hover:text-fg-primary` → `hover:bg-surface-overlay hover:text-content-primary`；其余 `text-fg-*` → `text-content-*`（行 65/74/82）。
RunProfilesPanel.tsx 行 146/184/185 `text-fg-*` → `text-content-*`。
ToastHost.tsx 行 41 `text-fg-primary` → `text-content-primary`。
ContextMenu.tsx 行 149 `text-fg-*` → `text-content-*`。
EnvDiffDialog.tsx：行 42 `border border-base-700 bg-base-900` → `border border-line bg-surface-panel`；其余 12 处 `text-fg-*` → `text-content-*`（行 35/40/41/44/45/50/51/52/56/57/58/61）。
ErrorBoundary.tsx 行 48 `text-fg-*` → `text-content-*`。
ProcessDetailSidebar.tsx 行 400 `text-red-400` → `text-danger`。

- [ ] **Step 2: grep 验证**：`grep -rn "text-fg-\|bg-base-\|border-base-\|text-red-400" app/src/` → 无输出（此时全仓失效令牌清零）

- [ ] **Step 3: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/runProfilesPanel.test.tsx tests/sessionPanel.test.tsx tests/toastHost.test.tsx`
Expected: 全 PASS

- [ ] **Step 4: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/RunLogView.tsx app/src/components/RunProfilesPanel.tsx app/src/components/ToastHost.tsx app/src/components/ContextMenu.tsx app/src/components/EnvDiffDialog.tsx app/src/components/ErrorBoundary.tsx app/src/components/ProcessDetailSidebar.tsx
git commit -m "fix(app): repair dead tokens and hardcoded colors across panels"
```

---

### Task 3: 表头统一 + 聚焦环 + 标签色 + 行高（4 表）

**Files:**
- Modify: `app/src/components/PortTable.tsx`（thead + 标签色 + 空态行已修）
- Modify: `app/src/components/ProcessTable.tsx`（thead + 聚焦环 + 行高 + 空态行）
- Modify: `app/src/components/StartupPanel.tsx`（thead 已修令牌）
- Modify: `app/src/components/ProjectGroupView.tsx`（thead + 聚焦环 + 行高 + 空态行）

- [ ] **Step 1: thead 统一规范**（4 张表的 thead 全部改为）：

```tsx
<thead className="sticky top-0 z-10 bg-surface-raised text-left text-xs uppercase text-content-muted">
```

各表现状与缺口：
- ProcessTable.tsx:563：现有 `sticky top-0 z-10 bg-surface-raised text-left text-xs text-content-muted`（Task 1 后）→ 补 `uppercase`
- PortTable.tsx:86：现有 `sticky top-0 bg-surface-raised text-left text-xs uppercase text-content-muted` → 补 `z-10`
- StartupPanel.tsx:37：现有 `sticky top-0 bg-surface-raised text-left text-xs uppercase text-content-muted` → 补 `z-10`
- ProjectGroupView.tsx:488：现有 `sticky top-0 z-10 bg-surface-raised text-left text-xs uppercase text-content-muted`（Task 1 后 bg-base-800 已修）→ 无需改

th 内边距统一：ProcessTable 的 th 若为 `px-2 py-2` 改为 `px-3 py-2`（PortTable/StartupPanel/ProjectGroupView 已是 px-3 py-2，grep 确认）。

- [ ] **Step 2: 聚焦环**：ProcessTable.tsx:129 与 ProjectGroupView.tsx:141 的 `ring-cyan-400/70` → `ring-accent/60`

- [ ] **Step 3: PortTable 标签色**（行 148-149）：

```tsx
                        isDevPort(c.localPort)
                          ? 'bg-accent/[0.14] text-accent'
                          : isDbPort(c.localPort)
                          ? 'bg-warn/[0.14] text-warn'
                          : 'bg-surface-raised text-content-secondary'
```

- [ ] **Step 4: 主表行高统一 py-2**：

ProcessTable 数据行：`grep -n "py-1.5" app/src/components/ProcessTable.tsx` 找到行 className → `py-1.5` 改 `py-2`（注意：仅数据行，spacer 行不动）。
ProjectGroupView 数据行：`grep -n "py-1" app/src/components/ProjectGroupView.tsx` 定位行 className → 数据行 `py-1` 改 `py-2`（虚拟列表行；**不要改** padding spacer 与组头行的 py-1——仅进程行）。若难以区分，以「行包含 name/pid 单元格的 className」为准。
PortTable/StartupPanel 行已是 py-2，不动。

- [ ] **Step 5: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/processPanelMultiSelect.test.tsx tests/portRadar.test.tsx tests/workspaceNavigation.test.tsx`
Expected: 全 PASS

- [ ] **Step 6: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/PortTable.tsx app/src/components/ProcessTable.tsx app/src/components/StartupPanel.tsx app/src/components/ProjectGroupView.tsx
git commit -m "style(app): unify table headers, focus ring, label colors, row heights"
```

---

### Task 4: 错误横幅统一到 PanelAlert（3 处）

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx:354`
- Modify: `app/src/components/PortRadar.tsx:133`
- Modify: `app/src/components/SnapshotPanel.tsx:264`

- [ ] **Step 1: ProcessPanel/PortRadar 横幅**（两处结构相同，逐文件处理）：

原（ProcessPanel.tsx:354-364 与 PortRadar.tsx:133-143，结构相同）：
```tsx
      {showErrorBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2">
          <p className="truncate text-xs text-danger">
            {error ? `上次刷新失败：${error}` : '上次刷新出错（已恢复）'}
          </p>
          <IconButton
            label="关闭错误提示"
            size="xs"
            variant="ghost"
            onClick={() => usePortRadarStore.getState().setError(null)}
            className="text-danger/80 hover:text-danger"
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      )}
```
改为（PanelAlert children 内嵌关闭按钮，行为不变）：
```tsx
      {showErrorBanner && (
        <PanelAlert tone="danger" className="flex items-center justify-between gap-3">
          <span className="truncate text-xs">
            {error ? `上次刷新失败：${error}` : '上次刷新出错（已恢复）'}
          </span>
          <IconButton
            label="关闭错误提示"
            size="xs"
            variant="ghost"
            onClick={() => usePortRadarStore.getState().setError(null)}
            className="text-danger/80 hover:text-danger"
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </PanelAlert>
      )}
```
ProcessPanel 的 onClick 对应其自己的 store setter（`useProcessPanelStore.getState().setError(null)`）——按原文件实际写法保留。
（PanelAlert 已确认：`extends HTMLAttributes<HTMLDivElement>`，className 透传支持 ✓——直接按上面写法。）

- [ ] **Step 2: SnapshotPanel 横幅**（行 264-267，无关闭按钮）：

```tsx
      {(error || currentFetchError) && (
        <div className="border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error || currentFetchError}
        </div>
      )}
```
改为：
```tsx
      {(error || currentFetchError) && (
        <PanelAlert tone="danger">{error || currentFetchError}</PanelAlert>
      )}
```

- [ ] **Step 3: import 检查**：3 个文件确认已 import PanelAlert（ProcessPanel/PortRadar 在 Task 5（反馈统一）后已无 PanelAlert import——需新增 `import { PanelAlert } from './ui/PanelAlert';`；SnapshotPanel 同理。用 `grep -n "PanelAlert" <file>` 确认后补 import）。

- [ ] **Step 4: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/processPanelMultiSelect.test.tsx tests/portRadar.test.tsx tests/snapshotPanelResponsive.test.tsx tests/snapshotPanelLocate.test.tsx`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx app/src/components/SnapshotPanel.tsx
git commit -m "refactor(app): unify error banners onto PanelAlert"
```

---

### Task 5: 空态统一到 StateView（2 面板）

**Files:**
- Modify: `app/src/components/SessionPanel.tsx:54-57`
- Modify: `app/src/components/RunProfilesPanel.tsx:126-129`

- [ ] **Step 1: SessionPanel 空态**（行 53-60 附近）：

```tsx
  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelActionBar label="AI 会话" />
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-content-muted">
          {scanning
            ? <>正在扫描进程…</>
            : <>未检测到 AI 开发会话。<br />Codex / Claude / Aider / Cursor / Ollama 等运行时会出现在此。</>}
        </div>
      </div>
    );
  }
```
改为（文案逐字保留——sessionPanel.test.tsx:34-35,41 用正则断言 `/正在扫描进程/` 与 `/未检测到 AI 开发会话/`）：
```tsx
  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelActionBar label="AI 会话" />
        <StateView
          state={scanning ? 'loading' : 'empty'}
          title={scanning ? '正在扫描进程…' : '未检测到 AI 开发会话'}
          description={scanning ? undefined : 'Codex / Claude / Aider / Cursor / Ollama 等运行时会出现在此。'}
        />
      </div>
    );
  }
```
确认 SessionPanel 已 import StateView（`grep -n "StateView"`，无则加 `import { StateView } from './ui/StateView';`）。

- [ ] **Step 2: RunProfilesPanel 空态**（行 126-129 附近）：

```tsx
        {profiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-content-muted">
            尚无 Run Profile。点「新建」配置一个开发服务（如 pnpm dev）。
          </div>
        ) : (
```
改为：
```tsx
        {profiles.length === 0 ? (
          <StateView
            state="empty"
            title="尚无 Run Profile"
            description="点「新建」配置一个开发服务（如 pnpm dev）。"
          />
        ) : (
```
确认 RunProfilesPanel 已 import StateView（无则补）。

- [ ] **Step 3: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/sessionPanel.test.tsx tests/runProfilesPanel.test.tsx`
Expected: 全 PASS（空态文案测试继续命中 StateView title/description）

- [ ] **Step 4: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/SessionPanel.tsx app/src/components/RunProfilesPanel.tsx
git commit -m "refactor(app): unify empty states onto StateView"
```

---

### Task 6: 圆角三级对齐 + 按钮 padding + 遮罩 + 图标细节

**Files:**
- Modify: `app/src/components/Panel.tsx:22`
- Modify: `app/src/components/ui/Dialog.tsx:97`
- Modify: `app/src/components/ContextMenu.tsx:137`
- Modify: `app/src/components/ToastHost.tsx:33`
- Modify: `app/src/components/ProcessPanel.tsx:257`、`app/src/components/PortRadar.tsx:111`（搜索框）
- Modify: `app/src/components/ProcessTable.tsx:217,227`、`app/src/components/SnapshotPanel.tsx:534`（btn-danger-quiet）
- Modify: `app/src/components/LabelRuleEditor.tsx:168,196,235`
- Modify: `app/src/components/ProjectGroupView.tsx:518,531`（排序箭头）

- [ ] **Step 1: 浮层圆角统一 14px**（4 处）：

| 位置 | 现值 | 改为 |
|---|---|---|
| Panel.tsx:22 | `rounded-[18px]` | `rounded-[14px]` |
| ui/Dialog.tsx:97 | `rounded-[20px]` | `rounded-[14px]` |
| ContextMenu.tsx:137 | `rounded-2xl` | `rounded-[14px]` |
| ToastHost.tsx:33 | `rounded-2xl` | `rounded-[14px]` |

- [ ] **Step 2: 控件圆角统一 rounded-lg**（2 处）：ProcessPanel.tsx:257 与 PortRadar.tsx:111 的 `rounded-md` → `rounded-lg`

- [ ] **Step 3: btn-danger-quiet padding 统一 `px-2 py-1`**：ProcessTable.tsx:217 与 227 的 `px-1.5 py-0.5` → `px-2 py-1`（字号 text-[10px] 保留）；SnapshotPanel.tsx:534 的 `px-3 py-1` → `px-2 py-1`

- [ ] **Step 4: LabelRuleEditor 遮罩**（行 168）：`bg-black/60` → `bg-black/40 backdrop-blur-sm`（与 Dialog 规范一致）

- [ ] **Step 5: LabelRuleEditor ✕ → IconButton + lucide X**：

加 import（若未导入）：
```tsx
import { IconButton } from './ui/IconButton';
import { X } from './icons';
```
行 196 关闭按钮：
```tsx
            <button onClick={onClose} className="text-content-muted hover:text-content-primary" aria-label="关闭">✕</button>
```
改为：
```tsx
            <IconButton label="关闭" size="xs" onClick={onClose}><X /></IconButton>
```
行 235 删除按钮：
```tsx
                    <button onClick={() => removeUserRule(u.id)}
                      className="ml-auto shrink-0 text-content-muted hover:text-danger" aria-label="删除">✕</button>
```
改为：
```tsx
                    <IconButton
                      label="删除"
                      size="xs"
                      className="ml-auto shrink-0 text-content-muted hover:text-danger"
                      onClick={() => removeUserRule(u.id)}
                    ><X /></IconButton>
```

- [ ] **Step 6: 排序箭头统一 ↑/↓**：ProjectGroupView.tsx:518 与 531 的 `" ▲"` → `" ↑"`、`" ▼"` → `" ↓"`（保留前导空格）

- [ ] **Step 7: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/processPanelMultiSelect.test.tsx tests/portRadar.test.tsx tests/toastHost.test.tsx tests/LabelRuleEditor.test.tsx tests/workspaceNavigation.test.tsx`
Expected: 全 PASS

- [ ] **Step 8: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/Panel.tsx app/src/components/ui/Dialog.tsx app/src/components/ContextMenu.tsx app/src/components/ToastHost.tsx app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx app/src/components/ProcessTable.tsx app/src/components/SnapshotPanel.tsx app/src/components/LabelRuleEditor.tsx app/src/components/ProjectGroupView.tsx
git commit -m "style(app): align radii, button padding, overlay, icon details to design system"
```

---

### Task 7: 全量验证（构建产物 + 测试 + 验收清单）

- [ ] **Step 1: 源码零残留**：

```bash
cd "E:\A_Project\codemgr/app" && grep -rn "text-fg-\|bg-base-\|border-base-\|ring-cyan\|amber-500\|slate-600\|text-red-400\|✕" src/ | grep -v "\.test\."
```
Expected: 无输出

- [ ] **Step 2: 构建 + 产物 grep**：

```bash
cd "E:\A_Project\codemgr" && pnpm build 2>&1 | tail -2
grep -c "text-fg-\|bg-base-\|border-base-" "E:\A_Project\codemgr/app/dist-renderer/assets/"*.css
```
Expected: 构建成功；grep 计数 = 0（0 命中时 grep -c 输出 `0`，若文件含该串则输出正数）

- [ ] **Step 3: 全量测试 + typecheck**：

```bash
cd "E:\A_Project\codemgr/app" && pnpm vitest run 2>&1 | tail -3 && pnpm typecheck
```
Expected: 593 passed（±0——视觉改动不增不减测试数）+ typecheck 干净

- [ ] **Step 4: 人工验收清单交付**（在最终报告中逐项确认 spec §6）：

- [ ] 构建产物 CSS 无 `text-fg-*`/`bg-base-*`/`border-base-*`/`ring-cyan` 残留（Step 2 已证）
- [ ] 4 张主表表头同底色/同 uppercase/同 padding/同弱化文字色（Task 3）
- [ ] 项目分组表头不再透明（bg-surface-raised 生效）
- [ ] 聚焦行为 accent 主题色
- [ ] 3 处错误横幅同为 PanelAlert，关闭交互不变
- [ ] SessionPanel/RunProfilesPanel 空态为 StateView，文案不变（测试已证）
- [ ] 浮层圆角 14px、控件 8px
- [ ] db 标签 warn 语义色
- [ ] LabelRuleEditor 关闭/删除为 lucide X
- [ ] 排序箭头全应用 ↑↓

- [ ] **Step 5: 提交（如有残留）**：`git status --short` 为空则跳过；有残留则精确 add 后 `git commit -m "chore(app): final display consistency sweep"`

---

## Self-Review 记录

- **Spec 覆盖**：§3.1 令牌修复（Task 1+2）✓；§3.2 表头（Task 3）✓；§3.3 行高（Task 3，SnapshotPanel diff 例外未动）✓；§3.4 横幅（Task 4）✓；§3.5 空态（Task 5 + Task 1/2 空态行令牌）✓；§3.6 圆角（Task 6）✓；§3.7 按钮（Task 6）✓；§3.8 图标（Task 6）✓；§4 验证（Task 7）✓。
- **Spec 偏差（有意）**：spec §3.2 提到 PerfPanel 表头补 sticky/bg——实现时**不改**（PerfPanel 网络表在非滚动卡片容器内，sticky/z-10 无效果；其文字已符合规范 `text-xs uppercase text-content-muted`）。理由记录于此。
- **占位符**：无 TBD；所有改动给到行级或 grep 定位指令。
- **类型一致性**：PanelAlert/StateView/IconButton 均确认支持所用 props（className 透传已核实；StateView title/description 已核实）。
