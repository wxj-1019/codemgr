# CodeMgr Aurora UI — 视觉重设计 Spec

> 版本: v1.2 | 日期: 2026-07-30 | 状态: 设计锁定
> v1.1 修订：方向从"霓虹 aurora"收敛为**「柔光 aurora」（Soft Aurora）**——保留苹果玻璃组件骨架与 Siri 辉光 differentiator，全面降低饱和度与辉光强度、放慢动效，以长时间使用的舒适度为第一优先级。
> **v1.2 修订：引入 Linear 的设计纪律**（分析 linear.app 首页实测，见 §0.1）——明度阶梯层级、1px hairline、颜色只用于语义、快而短的动效、内容紧凑容器松弛。**保留 Apple 核心材质**：毛玻璃面板（backdrop-blur）、连续圆角、柔光 aurora 环境底、Siri 辉光描边。一句话：**Linear 的骨，Apple 的肤。**
> 方法：遵循 frontend-design skill（锚点 + 差异化动作 + token 保真 + 内容纪律）。
> 预览：`docs/superpowers/specs/aurora-preview.html`（浏览器直接打开）。

---

## 0. 设计方向声明（Stated Direction）

**锚点：Aurora Maximalism 的柔光变体 + Linear 纪律。**

"仿苹果"不该停在 frosted white——那是 2019 年的苹果。Apple 当下最大胆的组件语言是 Siri/Apple Intelligence 的 aurora：暗底、mesh 渐变、玻璃拟态浮层。但纯 aurora 容易滑向"炫"，所以 v1.2 引入 Linear 的纪律来收：**颜色几乎不出现在界面里，出现时必是语义**；层级靠明度阶梯而非色相；结构靠 1px hairline 而非阴影。玻璃拟态圆角面板是苹果的肤，Linear 的克制是骨。

### 0.1 linear.app 实测分析（2026-07-30 截图取样）

| 维度 | Linear 的做法 | CodeMgr 的吸收 |
|------|--------------|----------------|
| 底色 | 不是纯黑，是"抬一格的黑"（≈#08090A）；面板再抬一格（≈#0F1114） | 放弃紫调深底，改中性抬格黑；层级=明度阶梯 |
| 结构 | 1px 极低存在边框（白 6-8%），小圆角（8-12px），几乎无阴影 | 边框压到 .06；面板圆角 16→14px，控件 8px |
| 颜色 | 界面近无彩色；彩色只出现在语义（状态点、优先级、标签）；品牌紫 #5E6AD2 全场只用一两处 | 强调色收敛为**一处品牌色**（柔紫 #8B93E8）+ 图表专用柔青；徽章/kind 色保留但降饱和 |
| 字体 | Inter，标题紧字距（letter-spacing 负值），三级灰文字（白/#8A8F98/#62666D），正文 12-13px 高密度 | 同三级灰；面板标题加 -0.01em 字距；数据 tabular-nums |
| 动效 | 快而短（150-250ms ease-out），无弹性夸张 | 从 300-400ms 回调到 200-250ms，动效幅度小、次数少 |
| 空间 | 内容紧凑、容器松弛（dense content, airy chrome） | 表格行高压实，面板内边距放宽 |
| 氛围光 | hero 区一点极淡的径向光，几乎不可见 | aurora mesh 再减半（.10/.05/.04），只余呼吸感 |

**差异化动作（Differentiator）：「Siri 辉光 · 柔光版」**——聚焦面板边缘一圈缓慢流转的 aurora 描边（conic-gradient，16s 旋转，低透明度 + 静态柔光外晕），像 Siri 被唤醒时的屏幕边缘光，但收着亮度：存在感来自"流动"而非"刺眼"。危险操作（结束进程/批量结束）hover 时描边转为柔和玫瑰色。纯 CSS、零运行时开销、支持 `prefers-reduced-motion`。

**约束**：数据密度是这个应用的命。aurora 只做**环境光**（压暗垫底），所有表格/图表内容落在 frosted glass 面板上；颜色纪律照 Linear——界面近无彩色，彩色必是语义。

## 1. Token 系统（锚点保真）

### 1.1 表面（Surface）

| 层 | Token | 值 |
|----|-------|-----|
| 环境底 | `--bg-base` | `#08090C`（Linear 式"抬一格的黑"，中性不带紫调） |
| mesh 层 | `.aurora-mesh` | `radial-gradient(60% 80% at 15% 0%, rgba(109,76,214,.10), transparent 60%), radial-gradient(50% 60% at 85% 15%, rgba(224,80,140,.05), transparent 55%), radial-gradient(70% 90% at 80% 90%, rgba(80,200,230,.04), transparent 60%)`——只余呼吸感 |
| 玻璃面板 | `--bg-panel` | `rgba(15,17,21,.72)` + `backdrop-filter: blur(20px) saturate(1.15)`（明度阶梯第一格，中性灰黑玻璃） |
| 浮层 | `--bg-elevated` | `rgba(24,26,32,.80)` + 同 blur（明度阶梯第二格） |
| 边框 | `--border` | `rgba(255,255,255,.07)`（1px hairline，Linear 纪律） |
| 圆角 | — | 面板 14px、控件 8px、徽章 999px（Apple 连续圆角，向 Linear 收一档） |

### 1.2 文字与强调色（Linear 纪律 + 柔光档）

| 用途 | Token | 值 | 说明 |
|------|-------|-----|------|
| 主文字 | `--text-primary` | `#F7F8F8` | Linear 同款近白 |
| 次文字 | `--text-secondary` | `#8A8F98` | Linear 同款中灰 |
| 弱文字 | `--text-muted` | `#62666D` | Linear 同款弱灰 |
| 品牌强调 | `--accent` | `#8B93E8` | Linear 紫 #5E6AD2 的柔光档；**全场只用一处**：选中态/主按钮/聚焦辉光 |
| 图表强调 | `--accent-data` | `#67E8F9`（cyan-300） | 仅用于图表/GPU 列等数据可视化 |
| 警示 | `--danger` | `#FB7185`（rose-400） | kill/超限，柔和玫瑰 |
| 警告 | `--warn` | `#FCD34D`（amber-300） | |
| 辉光 | — | `text-shadow: 0 0 12px color-mix(in srgb, <accent> 30%, transparent)` 仅强调态；正文零辉光 | 强度减半 |

### 1.3 字体与动效

- UI/正文：**Inter Variable**（`font-family: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`），数据用 `font-variant-numeric: tabular-nums`。
- 等宽：PID/端口/命令行保留现有 mono 栈（内容纪律：数据就是数据）。
- 动效：**快而短，Linear 纪律**——`ease-out` **200–250ms**，幅度小、次数少（hover 只换背景色，不上浮不缩放）；辉光描边 `conic-gradient` **16s** 线性无限旋转 + 静态柔光外晕（`box-shadow: 0 0 32px rgba(139,147,232,.18), 0 0 64px rgba(103,232,249,.05)`）。
- 尊重 `prefers-reduced-motion`：关闭描边旋转。

### 1.4 亮主题（工程权衡）

锚点以暗色为本，但应用承诺双主题。亮主题执行"frosted white glass over soft aurora wash"：底 `#F4F3FA` + 同构 mesh（饱和度降到 6–8%）、面板 `rgba(255,255,255,.65)` + blur(20px)、边框 `rgba(20,16,40,.08)`、强调色不变。这是为保留既有功能的自觉折衷，记为锚点的唯一让步。

## 2. 组件映射

| 组件 | 处理 |
|------|------|
| 全局背景 | body 上叠 `.aurora-mesh` 固定层（`position:fixed; z-index:-1`） |
| Panel / mosaic window | glass 面板（背景+blur+14px 圆角+1px hairline）；mosaic 工具栏改 `--bg-elevated` 半透明 + 下缘 1px |
| 聚焦面板 | `.panel-active` 伪元素 conic-gradient 描边（Siri 辉光，differentiator 本体，mask 裁 2px 环防渗入） |
| nav 工具栏 | glass 条 + Linear 式克制：文字型 ghost 按钮为主，仅一个 accent 实色主按钮 |
| 表格 | 行高压实（内容紧凑）、表头弱文字小写（不 filler）、行 hover `--bg-elevated`、选中行左侧 2px accent 光条、斑马纹不用 |
| 标签徽章 | kind 色保留语义（dev/db/ai…），样式统一为 `color-mix(in srgb, <kind> 14%, transparent)` 底 + `<kind>` 字色 + 999px 圆角，饱和度全面降档 |
| 危险按钮 | Linear 式安静危险：透明底 + `--danger` 细边与文字，hover 才填实 + 柔光 `0 0 14px rgba(251,113,133,.30)` |
| 图表（Recharts） | 主序列 `--accent-data` 柔青、次序列 `--accent` 柔紫、网格线 `rgba(255,255,255,.05)`、tooltip glass |
| 滚动条 | 8px 细轨，thumb `rgba(255,255,255,.12)` hover 提亮 |

## 3. 内容纪律（skill §2 对照）

- 所有界面文案沿用现有真实 copy（进程/端口雷达/结束进程/搜索进程…），不发明 themed 替代品。
- 不新增任何 filler 标签、mono-caps 副标题、`//` kicker、unicode 图标。
- 预览页样例数据明确标注"设计预览 · 样例数据"。

## 4. 分阶段实施

| 阶段 | 内容 | 文件 |
|------|------|------|
| **P1 token 层** | index.css 变量重构 + aurora-mesh + glass 工具类 + tailwind accent 改读变量 + 亮主题 | `app/src/index.css`、`app/tailwind.config.ts` |
| **P2 组件换肤** | Panel/mosaic/nav/按钮/表格/徽章/图表/滚动条；不动逻辑 | `app/src/components/*`、`index.css` 覆盖层 |
| **P3 辉光 + 验收** | `.panel-active` 描边动效、reduced-motion、亮暗主题人工验收、截图入 README | `index.css`、`Panel.tsx` |

红线：只动样式与 className，不碰 store/hook/IPC 逻辑；每阶段 `pnpm vitest run && pnpm typecheck` 全绿才进下一阶段；现有组件测试若断言了具体色值需同步更新（先跑测试看哪些挂）。

## 5. 验收清单

- [ ] token 保真：渲染 CSS 中无锚点外 token（无暖纸色、无衬线、无硬阴影做结构）
- [ ] differentiator 可见：聚焦面板的 Siri 辉光在亮/暗主题都清晰可辨
- [ ] 2000 行虚拟表格滚动无掉帧（blur 开销实测，必要时表格区面板降 blur 至 12px）
- [ ] 内容纪律：无 filler、无伪造数据、无 unicode 图标
- [ ] `prefers-reduced-motion` 下描边静止
- [ ] app 197+/197+ 测试全绿（样式改动不挂测试）
