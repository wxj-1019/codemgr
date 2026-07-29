# Impeccable 诊断报告 — CodeMgr Aurora UI v1.2（2026-07-30）

> 方法：`E:\A_file\frontend-skill\impeccable` 检查清单，对**带样例数据的真实渲染**逐项审计。
> 样机：`docs/superpowers/specs/audit-shim.html`（mock `window.codemgr`）→ 构建后经 `app/scripts/gen-audit.py` 生成 `dist-renderer/audit.html`，无头 Edge 截图。
> 对比图：`audit-before.png`（修复前）/ `audit-after.png`（修复后）。

## 🔴 P0 — 已修复

1. **[内存列]** `formatMem` 输出裸 MB 数字（"4710"、"288.0"），大数字无单位换算 → 改 `formatBytes`（`4.6 GB`/`288.0 MB`），表头"内存/MB"→"内存"，列加 `whitespace-nowrap` + 列宽 w-20→w-24（修复引入的折行回归后复验通过）。
2. **[nav/视图切换/分组图标]** emoji 充当图标（☀️🌙🚀📁🌲📦）——违反内容纪律且视觉廉价 → 主题切换改 SVG 太阳/月亮；自启改纯文字"自启 · 开"；视图切换改纯文字；📁/📦 改共享 `icons.tsx`（FolderIcon/PackageIcon，12px 线框 currentColor）。

## 🟠 P1 — 已修复

3. **[双层标题重复]** classic 单面板下 mosaic 窗口工具栏与面板自身 header 都显示"进程" → 单叶布局时 CSS 隐藏 mosaic 工具栏（`.single-leaf`），多面板时保留（拖拽/拆分需要）。
4. **[详情侧栏空态]** 空侧栏占 1/3 宽，"选中一个进程查看详情"顶格小字 → 居中、降一档（text-xs + 70% 透明）。
5. **[表头样式]** `uppercase` 对中文无意义且产生怪异字距 → 移除。
6. **[复选框]** 原生默认样式与柔紫 accent 不统一 → 全局 `accent-color: var(--accent)`。

## 🟡 P2 — 记录，未处理

1. **[表格区空态]** 数据少时面板下半部大面积死黑——属布局内容问题（行数少），非缺陷；未来可考虑空态插图或"最近进程"填充。
2. **[选中行 2px accent 光条]** `<tr>` inset box-shadow 在 border-collapse 下不渲染，需改结构（留 v2.x 评估）。
3. **[行密度]** 当前行高 ~34px（按钮撑高），Linear 式高密度可压到 ~28px——需把行内按钮改 hover 才显示，交互变更，留评估。

## 🟢 P3 — 持续

1. 辉光描边动效、玻璃 blur 性能需实机验收。
2. 亮主题（frosted white）未做视觉验收。

## 复查结论

修复后复截 `audit-after.png`：表头与数据对齐、内存单位可读、无 emoji、无重复标题、空态得体。清单其余项（间距一致性、圆角协调、灰温统一、背景/文字层级、边框 1px、动效 200-250ms、状态完整性）在 v1.2 token 层已覆盖，本轮标记通过。
