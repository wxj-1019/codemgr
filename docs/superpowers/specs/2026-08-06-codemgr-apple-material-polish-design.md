# 苹果质感深化（Apple Material Polish）

日期：2026-08-06
状态：已批准（方向：在 Aurora「暗色玻璃 + Linear 纪律」骨架上做苹果化收口，不推翻既有设计语言）
关联：`2026-07-30-codemgr-aurora-ui.md`（Aurora 设计系统，本迭代在其上）、`2026-08-01-codemgr-display-consistency-design.md`（显示一致性基线）

---

## 1. 背景与差距

Aurora 已实现「暗底 + 玻璃面板 + Linear 颜色纪律 + Siri 辉光」。用户要求进一步参考苹果设计风格。差距审计（2026-08-06）：

| 维度 | 现状 | 苹果风格差距 |
|------|------|-------------|
| 字体 | tailwind 仅定义 mono，sans 用默认栈（system-ui） | 未显式走 SF/Segoe UI Variable/PingFang 系统栈 |
| 侧边栏选择态 | 2px accent 竖条指示器（`::before`）+ 整块 raised 高亮 | macOS 侧边栏是**圆角胶囊高亮 + 文字加粗**，无竖条 |
| 材质 | `.glass` blur(20px) saturate(1.15)，侧边栏与内容同材质 | 苹果侧边栏是独立更透的材质层，「浮在内容上」 |
| 亮色模式 | canvas 粉白（255 248 252），panel alpha 0.62 | 亮色玻璃更实（alpha 提高）、底色更中性 |
| 动效 | `--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)` | 苹果标准曲线 `0.32, 0.72, 0, 1` |

## 2. 决策

**苹果化收口，六项，全部在「肤」层（材质/字体/选择态/动效），不动「骨」（数据密度、字号体系、语义色、图标、布局结构）**。零逻辑改动、零 native。

## 3. 改动设计

### 3.1 系统字体栈（tailwind.config.ts）

`fontFamily.sans` 新增（mono 保留）：

```ts
sans: [
  '-apple-system', 'BlinkMacSystemFont',   // macOS/iOS 原生 SF
  'SF Pro Text',                            // 显式 SF
  'Segoe UI Variable', 'Segoe UI',          // Windows 11/10（可变字体，苹果风）
  'PingFang SC', 'Microsoft YaHei',         // 中文
  'system-ui', 'sans-serif',
],
```

意图：Mac 上原生 SF 渲染；Win11 上 Segoe UI Variable（微软的苹果风可变字体）；中文 PingFang/雅黑兜底。注释写明。

### 3.2 侧边栏选择态胶囊化（核心苹果特征）

- `WorkspaceSidebar.tsx` 的 WorkspaceDestination active className：
  `'bg-surface-raised text-content-primary'` → `'rounded-lg bg-surface-raised font-medium text-content-primary'`（胶囊 + 加粗）
- 非 active 项 hover：`hover:bg-surface-raised/50`（柔和过渡，照既有按钮 hover 惯例）
- `index.css` 移除 `::before` 竖条指示器（`data-active='true'::before` 整块删除——macOS 无竖条），`data-active='true'` 的 `position: relative` 保留与否以无引用为准清理
- 窄 rail 模式（≤720px）下胶囊样式保持（宽度满格，圆角仍成立）

### 3.3 材质分层

- `.glass`（面板）：`blur(20px) saturate(1.15)` → `blur(24px) saturate(1.2)`；inset 高光与边框不变
- `.glass-elevated` / `.glass-soft`：同 blur 提升（24px），saturate 1.2
- `.workspace-sidebar`（index.css:468）：背景改更透材质——`background: rgb(var(--surface-panel-rgb) / 0.45)`（从现有值 Read 后按结构微调）+ `backdrop-filter: blur(20px) saturate(1.2)`——视觉上侧边栏与内容区材质分层（侧边栏更透、浮感）。若 sidebar 当前已是纯色背景（无 blur），则补 backdrop-filter + 降 alpha。**实施时以 Read 到的 `.workspace-sidebar` 现状为准做最小改动**。

### 3.4 亮色模式打磨（:root.light）

- `--surface-canvas-rgb: 255 248 252` → `250 250 252`（更中性，弱化粉调；品牌 accent 粉保留）
- `--surface-panel-alpha: 0.62` → `0.72`（亮色玻璃更实，保证文字对比）；raised/overlay alpha 同步微调（raised 0.85→0.88、overlay 0.96 不动）
- 亮色下侧边栏材质同 3.3 规则（更透层）

### 3.5 动效微调（index.css）

- `--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)` → `150ms cubic-bezier(0.32, 0.72, 0, 1)`（苹果标准曲线）
- `--transition-base/slow` 不动（面板激活呼吸光等长动效保留）
- `.workspace-sidebar-item` 加 `transition: background-color var(--transition-fast), color var(--transition-fast)`（胶囊 hover/active 切换柔和）

### 3.6 明确不动

- 表格行高/字号/字距体系、语义色（success/info/accent/danger/warn）、kind 徽章、lucide 图标、Switch 控件（AutoLaunchToggle 已苹果风）、布局结构（shell grid/面板树）、Siri 辉光、aurora mesh。

## 4. 验证策略

- 纯 CSS/类名/配置改动：全量测试回归（app 646 不变——无测试断言字体栈/侧边栏类名？`workspaceNavigation.test.tsx` 断言侧边栏按钮文本与分组，不含 class——确认后如有类名断言则适配）
- typecheck 干净
- 构建产物验证：`pnpm build` 后 dist CSS 含新字体栈（grep `Segoe UI Variable`）
- 人工验收清单（§6）

## 5. 不做的事

- 不做 macOS 平台特性（vibrancy 系统级材质、titlebar 透明、SF Symbols 替换 lucide——Windows 平台无意义）
- 不重设计系统（不推翻 Aurora token 体系）
- 不改布局结构/信息架构

## 6. 验收清单

- [ ] 侧边栏 active 项为圆角胶囊高亮 + 加粗，无竖条；hover 柔和
- [ ] 面板/浮层玻璃更润（blur 24px + saturate 1.2），侧边栏材质更透与内容分层
- [ ] 亮色模式：底色更中性、玻璃更实，胶囊选择态清晰
- [ ] 字体渲染：Mac 原生 SF / Win11 Segoe UI Variable（构建产物 CSS 含新栈）
- [ ] hover 过渡 150ms 苹果曲线
- [ ] app 646/646 + typecheck 干净 + native 51 不变
- [ ] 数据密度/语义色/图标无回归（人工目视抽查）
