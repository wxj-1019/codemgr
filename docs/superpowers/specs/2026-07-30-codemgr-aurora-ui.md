# CodeMgr Aurora UI — 视觉重设计 Spec

> 版本: v1.1 | 日期: 2026-07-30 | 状态: 设计锁定
> v1.1 修订：方向从"霓虹 aurora"收敛为**「柔光 aurora」（Soft Aurora）**——保留苹果玻璃组件骨架与 Siri 辉光 differentiator，全面降低饱和度与辉光强度、放慢动效，以长时间使用的舒适度为第一优先级。
> 方法：遵循 frontend-design skill（锚点 + 差异化动作 + token 保真 + 内容纪律）。
> 预览：`docs/superpowers/specs/aurora-preview.html`（浏览器直接打开）。

---

## 0. 设计方向声明（Stated Direction）

**锚点：Aurora Maximalism。**

选它的理由要先纠正一个直觉："仿苹果"不等于 frosted white——那是 2019 年的苹果。Apple 当下最大胆的组件语言是 **Apple Intelligence / Siri 的 aurora**：暗底、mesh 渐变、霓虹辉光描边、玻璃拟态浮层。用户的 brief 是"仿苹果的组件风格 + 大胆创新"，这两半在 Aurora 里合流——玻璃拟态圆角面板是苹果组件的骨，aurora 辉光是当代苹果的胆。而 Swiss（白底 Helvetica 网格）对开发者监控工具是安全但平庸的配对，且与暗色优先的使用场景相悖。

**差异化动作（Differentiator）：「Siri 辉光 · 柔光版」**——聚焦面板边缘一圈缓慢流转的 aurora 描边（conic-gradient，16s 旋转，低透明度 + 静态柔光外晕），像 Siri 被唤醒时的屏幕边缘光，但收着亮度：存在感来自"流动"而非"刺眼"。危险操作（结束进程/批量结束）hover 时描边转为柔和玫瑰色。纯 CSS、零运行时开销、支持 `prefers-reduced-motion`。

**约束**：数据密度是这个应用的命，舒适度是这次修订的纲。aurora 只做**环境光**（压暗至更低亮度垫底），所有表格/图表内容落在 frosted glass 面板上；强调色整体从"霓虹"降到"柔光"档（cyan-300/violet-300/rose-400 量级），正文降一档亮度防眩光。

## 1. Token 系统（锚点保真）

### 1.1 表面（Surface）

| 层 | Token | 值 |
|----|-------|-----|
| 环境底 | `--bg-base` | `#100E1D`（深紫黑，比纯黑抬一档，减少明暗反差刺眼感） |
| mesh 层 | `.aurora-mesh` | `radial-gradient(60% 80% at 15% 0%, rgba(109,76,214,.16), transparent 60%), radial-gradient(50% 60% at 85% 15%, rgba(224,80,140,.08), transparent 55%), radial-gradient(70% 90% at 80% 90%, rgba(80,200,230,.07), transparent 60%)`——三色饱和度与透明度全面减半，只作呼吸感环境光 |
| 玻璃面板 | `--bg-panel` | `rgba(28,24,52,.55)` + `backdrop-filter: blur(20px) saturate(1.25)` |
| 浮层 | `--bg-elevated` | `rgba(40,35,68,.70)` + 同 blur |
| 边框 | `--border` | `rgba(255,255,255,.06)`（1px，柔和低存在） |
| 圆角 | — | 面板 16px、控件 10px、徽章 999px（连续圆角，苹果组件特征） |

### 1.2 文字与强调色（柔光档）

| 用途 | Token | 值 | 说明 |
|------|-------|-----|------|
| 主文字 | `--text-primary` | `#E9E6F5` | 降一档亮度，长时间阅读不眩光 |
| 次文字 | `--text-secondary` | `#A39EBF` | |
| 弱文字 | `--text-muted` | `#6E6890` | |
| 主强调 | `--accent` | `#67E8F9`（cyan-300） | 从霓虹 `#00F0FF` 降到柔光档 |
| 次强调 | `--accent-2` | `#C4B5FD`（violet-300） | |
| 警示 | `--danger` | `#FB7185`（rose-400） | 从品红 `#FF006E` 降到柔和玫瑰 |
| 警告 | `--warn` | `#FCD34D`（amber-300） | |
| 辉光 | — | `text-shadow: 0 0 12px color-mix(in srgb, <accent> 30%, transparent)` 仅强调态；正文零辉光 | 强度减半 |

### 1.3 字体与动效

- UI/正文：**Inter Variable**（`font-family: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`），数据用 `font-variant-numeric: tabular-nums`。
- 等宽：PID/端口/命令行保留现有 mono 栈（内容纪律：数据就是数据）。
- 动效：`cubic-bezier(.22,1,.36,1)`（spring 感）**300–400ms**（放慢，动作更稳）；辉光描边 `conic-gradient` **16s** 线性无限旋转 + 静态柔光外晕（`box-shadow: 0 0 32px rgba(109,76,214,.22), 0 0 64px rgba(103,232,249,.07)`）；面板 hover **不再上浮**（减少视觉噪动，保留背景色变化）。
- 尊重 `prefers-reduced-motion`：关闭描边旋转与上浮。

### 1.4 亮主题（工程权衡）

锚点以暗色为本，但应用承诺双主题。亮主题执行"frosted white glass over soft aurora wash"：底 `#F4F3FA` + 同构 mesh（饱和度降到 6–8%）、面板 `rgba(255,255,255,.65)` + blur(20px)、边框 `rgba(20,16,40,.08)`、强调色不变。这是为保留既有功能的自觉折衷，记为锚点的唯一让步。

## 2. 组件映射

| 组件 | 处理 |
|------|------|
| 全局背景 | body 上叠 `.aurora-mesh` 固定层（`position:fixed; z-index:-1`） |
| Panel / mosaic window | glass 面板（背景+blur+16px 圆角+1px border）；mosaic 工具栏改 `--bg-elevated` 半透明 + 下缘 1px |
| 聚焦面板 | `.panel-active` 伪元素 conic-gradient 描边（Siri 辉光，不同iator 本体） |
| nav 工具栏 | glass 条 + 主按钮 accent 实色 + 其余 ghost |
| 表格 | 表头弱文字小写非全大写（不 filler）、行 hover `--bg-elevated`、选中行左侧 2px accent 光条、斑马纹不用 |
| 标签徽章 | kind 色保留语义（dev/db/ai…），样式统一为 `color-mix(in srgb, <kind> 18%, transparent)` 底 + `<kind>` 字色 + 999px 圆角；`ai` 品红、GPU 列 cyan |
| 危险按钮 | `--danger` 实色 + hover 柔光 `0 0 14px rgba(251,113,133,.35)` |
| 图表（Recharts） | 主序列 cyan、次序列 violet、网格线 `rgba(255,255,255,.06)`、tooltip glass |
| 滚动条 | 8px 细轨，thumb `rgba(255,255,255,.14)` hover 提亮 |

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
