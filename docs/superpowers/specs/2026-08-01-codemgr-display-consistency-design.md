# 显示层一致性收口（v2.4 合并后视觉漂移修复）

日期：2026-08-01
状态：已批准（方案 A：单批收口，严格对齐既有 Aurora 设计系统，无新设计决策）
关联：`2026-07-30-codemgr-aurora-ui.md`（设计系统规范）、`2026-07-30-codemgr-desktop-workbench-design.md`（语义令牌）

---

## 1. 背景

v2.4 大型合并（32 冲突 union 解决）后，渲染层出现一批**用户可感知的显示漂移**。审计结论（2026-08-01 显示层审计，agent 全仓扫描）：

**核心事实**：`app/tailwind.config.ts` 只定义 `surface/content/line/focus/success/info/accent/danger/warn/on-accent` 语义色，**没有 `fg` 与 `base`**。全部 `text-fg-*` / `bg-base-*` / `border-base-*` 是**静默失效的 no-op 类**（构建产物 CSS 已验证 0 命中）——文字回退继承色（变亮）、背景/边框完全不渲染。

| # | 问题 | 规模 |
|---|------|------|
| 1 | `text-fg-*` 失效类（弱化文字渲染成主文字亮色） | 56 处 / 10 文件（fg-muted 27、fg-primary 19、fg-secondary 10） |
| 2 | `bg-base-700/800/900`、`border-base-700` 失效 | 6 处（ProjectGroupView 表头透明、EnvDiffDialog/RunLogView 无背景无边框） |
| 3 | 表头两派：uppercase 有无、文字色失效 vs 正常、z-index 缺失、padding px-2 vs px-3 | 7 处 thead |
| 4 | 聚焦行 `ring-cyan-400/70` vs 全应用 `ring-accent/60`（青色 vs 主题紫） | 2 处 |
| 5 | 表格行高跨表不统一（py-2/py-1.5/py-1） | 4 张表 |
| 6 | 错误横幅 3 种形态（手写 px-4 带关闭 / 手写 px-3 无关闭 / 共享 PanelAlert） | 3 处手写 |
| 7 | 空态 3 种呈现（td 内嵌行 / 整屏手写文字 / StateView） | 4+ 处 |
| 8 | 圆角漂移：面板 18/20px、浮层 16px vs 规范 14px；控件 rounded-md(6px) vs 规范 8px | 5+ 处 |
| 9 | `btn-danger-quiet` padding 三档（px-1.5/px-2/px-3） | 3 处 |
| 10 | 图标细节：文本 `✕` vs lucide X；排序箭头 `▲▼` vs `↑↓` 两套 | 2+ 处 |
| 11 | 硬编码色：`bg-amber-500/[0.14] text-amber-400`、`bg-slate-600/[0.14]`、`text-red-400` | 2 处 |
| 12 | 模态遮罩两档：`bg-black/60` 无 blur vs `bg-black/40 backdrop-blur-sm` | 1 处漂移 |

## 2. 决策

**单批收口**：全部改动是"回归既有 Aurora 规范"的修复，不引入任何新视觉设计。映射关系在 §3 明确到令牌级，实现按表机械执行。分两批的价值低（令牌修复与样式统一同一批回归风险也低，均为纯 class 级改动）。

## 3. 改动设计

### 3.1 失效令牌修复（映射表）

| 失效类 | 替换 | 数量 |
|--------|------|------|
| `text-fg-primary` | `text-content-primary` | 19 |
| `text-fg-secondary` | `text-content-secondary` | 10 |
| `text-fg-muted` | `text-content-muted` | 27 |
| `bg-base-700`（RunLogView 日志区） | `bg-surface-overlay` | 1 |
| `bg-base-800`（ProjectGroupView 表头） | `bg-surface-raised`（并入 §3.2 表头规范） | 1 |
| `bg-base-900`（EnvDiffDialog/RunLogView 内容块） | `bg-surface-panel` | 2 |
| `border-base-700` | `border-line` | 2 |
| `ring-cyan-400/70`（聚焦行） | `ring-accent/60` | 2 |
| `bg-amber-500/[0.14] text-amber-400`（db 标签） | `bg-warn/[0.14] text-warn` | 1 |
| `bg-slate-600/[0.14]`（其他标签） | `bg-surface-raised text-content-secondary` | 1 |
| `text-red-400`（ProcessDetailSidebar） | `text-danger` | 1 |
| `bg-black/60`（LabelRuleEditor 遮罩） | `bg-black/40 backdrop-blur-sm`（Dialog 规范） | 1 |

**验证**：构建后 `grep -c "text-fg-\|bg-base-\|border-base-" dist-renderer/assets/*.css` = 0，且映射目标类（如 `text-content-muted`）在产物中正常生成。

### 3.2 表头统一规范（7 处 thead）

统一为：
```
sticky top-0 z-10 bg-surface-raised text-left text-xs uppercase text-content-muted
```
th 内边距统一 `px-3 py-2 font-medium`。

涉及：PortTable（补 z-10、改 fg→content）、ProcessTable（补 uppercase、改 fg→content）、StartupPanel（改 fg→content）、ProjectGroupView（bg-base-800→raised、改 fg→content）、SnapshotPanel diff 表（补 uppercase、px-3 py-2 对齐）、PerfPanel 网络表头（补 sticky/z-10/bg/uppercase/padding——与主表同规范）。

### 3.3 表格行高统一

主数据表数据行统一 `py-2`：ProcessTable `py-1.5→py-2`、ProjectGroupView `py-1→py-2`、PortTable/StartupPanel 已是 py-2。
**例外**：SnapshotPanel 的 diff 视图（added/removed/changed 行）保持紧凑 `py-1`——差异列表语义上是紧凑视图，与主数据表不同（有意为之，不统一）。

### 3.4 错误横幅统一到 PanelAlert

三处手写横幅收敛到共享组件：
- ProcessPanel.tsx:354（`px-4 py-2` 带关闭按钮）
- PortRadar.tsx:133（同上）
- SnapshotPanel.tsx:264（`px-3 py-2` 无关闭按钮）

统一为 `<PanelAlert tone="danger">`（现有共享组件，border-y + 图标 + px-3 py-2 样式，tone 语义化）。**保留各自的关闭/消除交互**：ProcessPanel/PortRadar 的关闭按钮逻辑改为 PanelAlert 后通过其 children 内嵌关闭按钮（若 PanelAlert 不支持动作则 children 内放按钮），SnapshotPanel 无关闭按钮的直接替换。实施时以保持行为等价为准则：横幅可关闭性不变。

### 3.5 空态统一

- **SessionPanel.tsx:54-57** 整屏手写空态/加载 → `StateView state="loading" title="正在扫描进程…"` / `StateView state="empty" title="未检测到 AI 开发会话"`（沿用原文案）。
- **RunProfilesPanel.tsx:126-129** 手写空态 → `StateView state="empty" title="尚无 Run Profile" description="点「新建」配置一个开发服务（如 pnpm dev）。"`（文案逐字保留）。
- 表格内嵌空态行（PortTable「暂无监听端口」、StartupPanel「未发现启动项」、ProcessTable「无进程」、ProjectGroupView「无进程」）**保留**（表格语义内嵌正确），统一样式 `px-3 py-8 text-center text-content-muted`（检查现行差异后对齐）。
- EnvDiffDialog/ProcessDetailSidebar 的手写读取中/失败文案**保留**（对话框内使用 StateView 过重），仅修令牌。

### 3.6 圆角三级规范对齐

Aurora 规范：面板 14px、控件 8px（rounded-lg）、徽章 999px（rounded-full）。

| 位置 | 现值 | 修正 |
|------|------|------|
| Panel.tsx:22 面板容器 | `rounded-[18px]` | `rounded-[14px]` |
| Dialog.tsx:97 对话框 | `rounded-[20px]` | `rounded-[14px]` |
| ContextMenu.tsx:137 | `rounded-2xl`(16px) | `rounded-[14px]` |
| ToastHost.tsx:33 | `rounded-2xl`(16px) | `rounded-[14px]` |
| 搜索框/输入控件（ProcessPanel:257、PortRadar:111） | `rounded-md`(6px) | `rounded-lg`(8px) |
| PollIntervalSelect.tsx:21 | `rounded-lg` ✓ | 不动 |
| LabelRuleEditor.tsx:174、PerfPanel.tsx:21 | `rounded-[14px]` ✓ | 不动 |

### 3.7 危险按钮与交互控件

- `btn-danger-quiet` padding 统一 `px-2 py-1`：PortTable:169 已是、ProcessTable:217/227 `px-1.5→px-2`、SnapshotPanel:534 `px-3→px-2`。

### 3.8 图标细节

- LabelRuleEditor.tsx:196,235 文本 `✕` → `IconButton` + lucide `X`（icons.tsx 已导出；aria-label 保留「关闭」/「删除」）。
- 排序箭头统一 `↑`/`↓`：ProjectGroupView:518,531 `▲▼→↑↓`（ProcessTable/PerfPanel 已是 ↑↓，不动）。

## 4. 验证策略

1. 构建产物 grep：`text-fg-|bg-base-|border-base-|ring-cyan|amber-400|slate-600|red-400` 在 dist CSS 中 0 命中（映射后）。
2. 全量测试：`cd app && pnpm vitest run` + `pnpm typecheck`（预期 593 不变或 ±0——视觉改动不应影响测试计数；改 StateView 的两处空态保留原文案，若有测试断言空态文案则继续通过）。
3. native 不动，无需重编译（但最终 `pnpm build` 会顺带 build:electron，保持 ABI 正确）。
4. 人工验收清单（§6）。

## 5. 不做的事

- 不引入新视觉设计/新令牌/新组件（PanelAlert/StateView/IconButton 全部复用既有）。
- 不动 SnapshotPanel diff 视图紧凑行高（有意设计）。
- 不动 workspace 侧栏/顶栏（审计确认令牌干净、样式一致）。
- 不重构大文件结构（ProcessTable/ProjectGroupView 仅 class 级替换）。

## 6. 验收清单

- [ ] 构建产物 CSS 无 `text-fg-*`/`bg-base-*`/`border-base-*`/`ring-cyan` 残留
- [ ] 4 张主表 + PerfPanel 表头视觉一致（同底色/同 uppercase/同 padding/同弱化文字色）
- [ ] 项目分组视图表头不再透明（滚动时无内容穿透）
- [ ] 进程表/端口表聚焦行为主题 accent 色而非青色
- [ ] 3 处错误横幅同为 PanelAlert 形态，关闭交互不变
- [ ] SessionPanel/RunProfilesPanel 空态为 StateView，文案不变
- [ ] 面板/对话框/菜单/toast 圆角统一 14px，控件统一 8px
- [ ] db 标签 amber → warn 语义色，浅色主题下可读
- [ ] LabelRuleEditor 关闭/删除为 lucide X 图标按钮
- [ ] 排序箭头全应用 ↑/↓ 一套
- [ ] app 593/593 + typecheck 干净
