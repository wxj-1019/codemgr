# 苹果质感深化（Apple Material Polish）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aurora 骨架上做苹果化收口：系统字体栈、侧边栏胶囊选择态、材质分层、亮色模式打磨、动效曲线。纯 CSS/配置/类名改动，零逻辑、零 native。

**Architecture:** 五处独立改动（tailwind 字体栈 / index.css 材质与动效 / WorkspaceSidebar 类名 / index.css 侧边栏材质 / :root.light 变量），每处一个提交。验证靠构建产物 grep + 全量测试回归 + 人工验收。

**Tech Stack:** Tailwind config + CSS 变量 + React 类名。基于 `feat/apple-material-polish` 分支（已建，基于 main 8c1607b）。

**关键事实（已核实）：**
- `tailwind.config.ts:39-45`：仅定义 `fontFamily.mono`，无 sans——默认 Tailwind sans 栈
- `index.css:16-18`：`--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)`、base/slow 300/400ms `cubic-bezier(0.34, 1.2, 0.64, 1)`
- `index.css:189-213`：`.glass`/`.glass-elevated`/`.glass-soft` 均 `blur(20px) saturate(1.15)`（glass-soft 12px/1.10）
- `index.css:468-477`：`.workspace-sidebar` 已有 `background: rgb(var(--surface-panel-rgb) / 0.85)` + `blur(24px) saturate(1.12)` + z-index 2
- `index.css:581-590`：`data-active='true'` 竖条指示器（`::before` 2px accent 渐变条）+ WorkspaceSidebar.tsx:96 的 `active && 'bg-surface-raised text-content-primary'`
- `index.css:85-97`：`:root.light` —— `--surface-canvas-rgb: 255 248 252`、panel alpha 0.62、raised 0.85、overlay 0.96
- `workspaceNavigation.test.tsx` 断言侧边栏按钮**文本与分组**（无 class 断言——确认后如有则适配）

**测试命令（app 目录）：** `npx vitest run <file>`；全量 `pnpm vitest run`；`pnpm typecheck`。

---

### Task 1: 系统字体栈（tailwind.config.ts）

**Files:**
- Modify: `app/tailwind.config.ts:39-45`

- [ ] **Step 1: 加 sans 栈**：

```ts
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', // macOS/iOS 原生 SF
          'SF Pro Text',                          // 显式 SF
          'Segoe UI Variable', 'Segoe UI',        // Windows 11/10（可变字体，苹果风）
          'PingFang SC', 'Microsoft YaHei',       // 中文
          'system-ui', 'sans-serif',
        ],
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
```

- [ ] **Step 2: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck`；`pnpm build` 后 `grep -c "Segoe UI Variable" dist-renderer/assets/*.css` 应为正数（字体栈进入产物）

- [ ] **Step 3: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/tailwind.config.ts
git commit -m "style(app): system-first font stack (SF/Segoe UI Variable)"
```

---

### Task 2: 动效曲线微调（index.css）

**Files:**
- Modify: `app/src/index.css:16`

- [ ] **Step 1: fast 曲线改苹果标准**：

```css
  --transition-fast: 150ms cubic-bezier(0.32, 0.72, 0, 1);
```

（base/slow 不动——面板呼吸光等长动效保留。加一行注释「苹果标准曲线（0.32, 0.72, 0, 1）」）

- [ ] **Step 2: 侧边栏项过渡**（在 `.workspace-sidebar-item` 规则内追加）：

```css
.workspace-sidebar-item {
  width: 100%;
  flex-shrink: 1;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
```

- [ ] **Step 3: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/index.css
git commit -m "style(app): apple motion curve for fast transitions"
```

---

### Task 3: 侧边栏胶囊选择态

**Files:**
- Modify: `app/src/components/workspace/WorkspaceSidebar.tsx:95-96`
- Modify: `app/src/index.css:581-590`

- [ ] **Step 1: 组件类名**（WorkspaceSidebar.tsx）：

`active && 'bg-surface-raised text-content-primary'` → `active && 'rounded-lg bg-surface-raised font-medium text-content-primary'`

同时 hover 柔和：非 active 项的基类已有 hover 样式则保留；若无则加 `hover:bg-surface-raised/50`（Read 该行确认现有 hover 处理）。

- [ ] **Step 2: 移除竖条指示器**（index.css）：

删除 `.workspace-sidebar-item[data-active='true']` 与 `::before` 两条规则（macOS 侧边栏无竖条，胶囊高亮替代）。若 `position: relative` 无其他引用则一并清理。

- [ ] **Step 3: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/workspaceNavigation.test.tsx`
Expected: 全 PASS（若测试断言类名则适配并报告）

- [ ] **Step 4: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/components/workspace/WorkspaceSidebar.tsx app/src/index.css
git commit -m "style(app): macOS-style capsule selection in sidebar"
```

---

### Task 4: 材质分层（玻璃提升 + 侧边栏更透）

**Files:**
- Modify: `app/src/index.css:189-213,468-477`

- [ ] **Step 1: 面板/浮层玻璃提升**：

`.glass`、`.glass-elevated`：`blur(20px) saturate(1.15)` → `blur(24px) saturate(1.2)`（两处 backdrop-filter + -webkit 前缀各同步）；`.glass-soft`：`blur(12px) saturate(1.10)` → `blur(16px) saturate(1.15)`。

- [ ] **Step 2: 侧边栏材质分层**（.workspace-sidebar）：

`background: rgb(var(--surface-panel-rgb) / 0.85)` → `rgb(var(--surface-panel-rgb) / 0.62)`；`saturate(1.12)` → `saturate(1.2)`（blur 24px 保持）——侧边栏更透，浮在内容之上。注释「macOS 侧边栏材质：比内容面板更透」。

- [ ] **Step 3: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/index.css
git commit -m "style(app): layered translucency — richer glass, airier sidebar"
```

---

### Task 5: 亮色模式打磨（:root.light）

**Files:**
- Modify: `app/src/index.css:85-97`

- [ ] **Step 1: 变量微调**：

```css
  --surface-canvas-rgb: 250 250 252;   /* 255 248 252 → 更中性（弱化粉调） */
  --surface-panel-alpha: 0.72;         /* 0.62 → 亮色玻璃更实，保证对比 */
  --surface-raised-alpha: 0.88;        /* 0.85 → 同步微调 */
```
（overlay 0.96 与其余变量不动；品牌 accent 粉保留）

- [ ] **Step 2: 验证**：`cd "E:\A_Project\codemgr/app" && pnpm typecheck && npx vitest run tests/themeStore.test.ts tests/workspaceNavigation.test.tsx`（themeStore 若存在；确认亮色切换逻辑无回归）

- [ ] **Step 3: 提交**

```bash
cd "E:\A_Project\codemgr" && git add app/src/index.css
git commit -m "style(app): neutral light canvas, more solid light glass"
```

---

### Task 6: 全量验证 + 文档收尾

- [ ] **Step 1: 全量测试 + typecheck**：`cd "E:\A_Project\codemgr/app" && pnpm vitest run 2>&1 | tail -3 && pnpm typecheck`
Expected: 646 PASS（±0，纯视觉改动）+ typecheck 干净

- [ ] **Step 2: 构建产物验证**：`pnpm build` 后 `grep -c "Segoe UI Variable" app/dist-renderer/assets/*.css` > 0；`grep -c "blur(24px)" app/dist-renderer/assets/*.css` > 0

- [ ] **Step 3: native 确认未动**：`git diff main..HEAD --stat -- codemgr-native/` → 空

- [ ] **Step 4: 文档**：
- `CHANGELOG.md` `[Unreleased]` 追加小节：

```markdown
### 苹果质感深化（2026-08-06）
- 系统字体栈（macOS 原生 SF / Windows Segoe UI Variable / 中文 PingFang·雅黑）。
- 侧边栏选择态改为 macOS 风格圆角胶囊高亮 + 加粗（移除竖条指示器），hover 柔和过渡。
- 材质分层：面板/浮层玻璃提升（blur 24px + saturate 1.2），侧边栏材质更透浮于内容之上。
- 亮色模式：底色中性化、玻璃更实；动效曲线统一为苹果标准（0.32, 0.72, 0, 1）。
```

- `AGENTS.md` §8：v2.5 条目追加一句「苹果质感深化（系统字体栈/侧边栏胶囊选择态/材质分层/亮色打磨/苹果动效曲线）」；测试数行确认 646 不变（若变则更新）

- [ ] **Step 5: 提交**

```bash
cd "E:\A_Project\codemgr" && git add CHANGELOG.md AGENTS.md
git commit -m "docs: record apple material polish iteration"
```

- [ ] **Step 6: 人工验收清单交付**（spec §6 逐项）：

- [ ] 侧边栏 active 项为圆角胶囊 + 加粗、无竖条、hover 柔和
- [ ] 玻璃更润（blur 24px）、侧边栏更透与内容分层
- [ ] 亮色模式底色中性、玻璃更实、胶囊清晰
- [ ] 构建产物含 Segoe UI Variable 字体栈
- [ ] hover 150ms 苹果曲线
- [ ] app 646/646 + typecheck + native 51 不变
- [ ] 数据密度/语义色/图标无回归（人工目视抽查）

---

## Self-Review 记录

- **Spec 覆盖**：§3.1 字体（T1）✓；§3.5 动效（T2）✓；§3.2 胶囊（T3）✓；§3.3 材质（T4）✓；§3.4 亮色（T5）✓；§4 验证（T6）✓。
- **占位符**：T3 Step 1「Read 确认现有 hover 处理」为适配指引（实现者先 Read 再改），非空泛占位。
- **类型一致性**：无跨任务类型依赖（纯 CSS/类名/配置）；workspaceNavigation.test.tsx 若有类名断言在 T3 适配。
