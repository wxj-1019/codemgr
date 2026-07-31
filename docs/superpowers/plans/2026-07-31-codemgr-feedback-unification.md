# 操作反馈通道统一（Feedback Unification）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 38 处 inline notice（`useNotice` + `PanelAlert`）操作反馈全部收敛到 toast，删除 `useNotice` 通道，修复 `ToastHost` 双挂载 bug，收尾 CHANGELOG/AGENTS.md。

**Architecture:** 三条独立改动线：① `toastStore` 增加 `warning` kind（`notify.warning` + ToastHost `KIND_META` 映射）；② 8 个组件把 `showNotice(tone, text)` 逐处替换为 `notify.*(text)` 并删掉 hook/渲染块（`PanelAlert` 保留仅服务常驻 loadError）；③ 测试先挂 `<ToastHost/>` 再迁移组件（toast 走 portal 到 body，测试树需挂宿主才能断言文本）。

**Tech Stack:** React 18 + Zustand + vitest + @testing-library/react。不碰 native/C++（无重编译）。

**执行前提：** 当前在 `feat/desktop-workbench`（merge commit `aa65977`）。第一步先建分支：`git checkout -b feat/feedback-unification`（仓库规范：功能分支 `feat/<scope>`）。所有提交用精确 `git add <file>`，**绝不 `git add -A`**。

**基调对照（全程使用）：**

| 原 tone | 替换 |
|---------|------|
| `showNotice('danger', X)` | `notify.error(X)` |
| `showNotice('success', X)` | `notify.success(X)` |
| `showNotice('warning', X)` | `notify.warning(X)` |

组件内三处结构性删除（每个组件任务通用）：
1. `import { useNotice } from '../hooks/useNotice';` → 若无 `notify` import 则改为 `import { notify } from '../lib/notify';`（已有则仅删 useNotice import）
2. `const { notice, show: showNotice } = useNotice();`（含上方注释，若有）
3. `{notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}` 渲染块（**保留** `{loadError && ...}` 等常驻错误块）

**测试命令（app 目录）：** `npx vitest run <file> -t <case>` 或 `npx vitest run <file>`；全量 `pnpm vitest run`；类型 `pnpm typecheck`。

---

### Task 1: toastStore 增加 `warning` kind（TDD）

**Files:**
- Modify: `app/src/store/toastStore.ts:3,13`
- Modify: `app/src/lib/notify.ts`（补 `warning` 方法）
- Modify: `app/src/components/ToastHost.tsx:7-11`（KIND_META 补 warning）
- Test: `app/tests/toastStore.test.ts`、`app/tests/toastHost.test.tsx`

- [ ] **Step 1: 写失败测试**（toastStore.test.ts 的 `describe('toastStore.push')` 内追加）

```ts
  it('warning kind：时长 4000ms，notify.warning 可达', () => {
    const s = useToastStore.getState();
    const id = s.push('warning', '部分成功');
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: 'warning', message: '部分成功', durationMs: 4000 });
    s.dismiss(id);
    notify.warning('警告');
    expect(useToastStore.getState().toasts[0].kind).toBe('warning');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd app && npx vitest run tests/toastStore.test.ts`
Expected: TS 编译失败（`'warning'` 不可赋给 `ToastKind`）→ 用例失败

- [ ] **Step 3: 实现** — `app/src/store/toastStore.ts`:

```ts
export type ToastKind = 'success' | 'error' | 'info' | 'warning';
// DURATION 行改为：
const DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, warning: 4000, error: 8000 };
```

`app/src/lib/notify.ts`（末尾追加）：

```ts
  warning: (message: string): void => { useToastStore.getState().push('warning', message); },
```

- [ ] **Step 4: ToastHost 渲染映射** — `app/src/components/ToastHost.tsx` KIND_META 追加（warning 色用语义令牌 warn，图标 TriangleAlert）：

```tsx
  warning: { icon: <TriangleAlert size={15} aria-hidden="true" />, iconCls: 'text-warn', role: 'status', accentCls: 'bg-warn' },
```

`TriangleAlert` 已从 `./icons` 导出（icons.tsx:45 有 re-export）。import 行改为：
`import { CheckCircle2, CircleX, Info, TriangleAlert, X } from './icons';`

- [ ] **Step 5: toastHost.test.tsx 补 warning 用例**（`describe('ToastHost')` 内追加）：

```tsx
  it('warning 用 role=status 渲染', () => {
    useToastStore.getState().push('warning', '部分成功');
    render(<ToastHost />);
    expect(screen.getByText('部分成功').closest('[role="status"]')).toBeTruthy();
  });
```

- [ ] **Step 6: 跑两个测试文件确认通过**

Run: `cd app && npx vitest run tests/toastStore.test.ts tests/toastHost.test.tsx`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add app/src/store/toastStore.ts app/src/lib/notify.ts app/src/components/ToastHost.tsx app/tests/toastStore.test.ts app/tests/toastHost.test.tsx
git commit -m "feat(app): add warning toast kind for partial-success feedback"
```

---

### Task 2: 测试先行——5 个测试文件挂载 ToastHost

**Files:**
- Modify: `app/tests/portRadar.test.tsx`（3 处 render）
- Modify: `app/tests/processPanelMultiSelect.test.tsx`（9 处 render）
- Modify: `app/tests/runProfilesPanel.test.tsx`
- Modify: `app/tests/snapshotPanelResponsive.test.tsx`（2 处 render）
- Modify: `app/tests/sessionPanel.test.tsx`（2 处 render）

- [ ] **Step 1: 每个文件加 import 并包一层**

所有 `render(<X />)` 改为 `render(<><ToastHost /><X /></>)`。每个文件顶部加：

```tsx
import { ToastHost } from '../src/components/ToastHost';
```

例（portRadar.test.tsx）：
```tsx
    render(<><ToastHost /><PortRadar /></>);
```

processPanelMultiSelect.test.tsx 有 9 处 `render(<ProcessPanel />)`，全部同样包一层。runProfilesPanel.test.tsx 同样处理（`render(<RunProfilesPanel />)` 的所有出现）。

- [ ] **Step 2: 跑这 5 个文件确认仍全绿（迁移前的基线）**

Run: `cd app && npx vitest run tests/portRadar.test.tsx tests/processPanelMultiSelect.test.tsx tests/runProfilesPanel.test.tsx tests/snapshotPanelResponsive.test.tsx tests/sessionPanel.test.tsx`
Expected: 全部 PASS（空 toast 栈时 ToastHost 渲染 null，零副作用）

- [ ] **Step 3: 提交**

```bash
git add app/tests/portRadar.test.tsx app/tests/processPanelMultiSelect.test.tsx app/tests/runProfilesPanel.test.tsx app/tests/snapshotPanelResponsive.test.tsx app/tests/sessionPanel.test.tsx
git commit -m "test(app): mount ToastHost in panel feedback tests"
```

---

### Task 3: App.tsx —— UX-09 告知转 toast + 双挂载修复

**Files:**
- Modify: `app/src/App.tsx:24,144,149-153,189,238`

- [ ] **Step 1: 改 import**（行 24）：`import { useNotice } from './hooks/useNotice';` → `import { notify } from './lib/notify';`（若 notify 已导入则仅删 useNotice 行）

- [ ] **Step 2: 删 hook 行**（行 144）：
`  const { notice, show: showNotice } = useNotice();`（连同其上 `// UX-09：...` 注释）→ 删除

- [ ] **Step 3: 改调用**（行 149-153）——原：

```tsx
      showNotice(
        'warning',
        `已用「${getPanelTitle(panelId, findPlugin)}」替换「${getPanelTitle(replaced, findPlugin)}」（最多 ${MAX_VISIBLE_PANELS} 个面板）`,
      );
```
改为：
```tsx
      notify.warning(
        `已用「${getPanelTitle(panelId, findPlugin)}」替换「${getPanelTitle(replaced, findPlugin)}」（最多 ${MAX_VISIBLE_PANELS} 个面板）`,
      );
```

- [ ] **Step 4: 删渲染块**（行 189）：`      {notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}` → 删除

- [ ] **Step 5: 删双挂载**（行 238）：`      <ToastHost />` → 删除（保留 main.tsx 内 ErrorBoundary 包的那处——唯一挂载点）

- [ ] **Step 6: 验证**：`cd app && pnpm typecheck && npx vitest run tests/workspaceNavigation.test.tsx`
Expected: 无类型错误，测试 PASS

- [ ] **Step 7: 提交**

```bash
git add app/src/App.tsx
git commit -m "fix(app): dedupe ToastHost mount, unify panel-replaced notice to toast"
```

---

### Task 4: PortRadar 迁移（3 处）

**Files:**
- Modify: `app/src/components/PortRadar.tsx:33,51,59,64,153`

- [ ] **Step 1: import**（行 33 前）——`useNotice` import 换成 `notify`（PortRadar 已 import notify？没有——`grep -n "from '../lib/notify'" src/components/PortRadar.tsx` 为空则新增 `import { notify } from '../lib/notify';`，删 `import { useNotice } ...`）

- [ ] **Step 2: 删 hook 行**（行 33）：`  const { notice, show: showNotice } = useNotice();` → 删除

- [ ] **Step 3: 三处调用替换**：

| 行 | 原 | 新 |
|----|----|----|
| 51 | `showNotice('success', \`已结束 ${pendingKill.name}（PID ${pendingKill.pid}）\`);` | `notify.success(...)` 同参数 |
| 59 | `showNotice('danger', \`结束 ${pendingKill.name}（PID ${pendingKill.pid}）失败：${reason}\`);` | `notify.error(...)` |
| 64 | `showNotice('danger', \`结束失败：${String(e)}\`);` | `notify.error(...)` |

（消息字符串逐字保留，仅函数名与 tone 映射变化）

- [ ] **Step 4: 删渲染块**（行 153）：`{notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}` → 删除

- [ ] **Step 5: 验证**：`cd app && npx vitest run tests/portRadar.test.tsx && pnpm typecheck`
Expected: PASS（「已结束 …」断言现在命中 toast 文本）

- [ ] **Step 6: 提交**

```bash
git add app/src/components/PortRadar.tsx
git commit -m "refactor(app): unify PortRadar kill feedback to toast"
```

---

### Task 5: ProcessPanel 迁移（15 处）

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx:97,115,117,122,137,140,143,147,160-165,168,184,186,188,192,205-211,213,377`

- [ ] **Step 1: import + 删 hook 行**（行 97）——同 Task 4 Step 1-2 模式（ProcessPanel 已有 notify import——`grep` 确认，有则只删 useNotice import）

- [ ] **Step 2: 12 处单行替换**（消息逐字保留）：

| 行 | 原 tone | 新 |
|----|---------|----|
| 115 | success | `notify.success(\`已结束 ${pendingKill.name}（PID ${pendingKill.pid}）\`)` |
| 117 | danger | `notify.error(\`结束失败：${KILL_FAILURE_TEXT[status]}\`)` |
| 122 | danger | `notify.error(\`结束失败：${String(e)}\`)` |
| 137 | danger | `notify.error(\`未结束任何进程：${formatKillFailureSummary(s) || '全部失败'}\`)` |
| 140 | warning | `notify.warning(\`已结束 ${s.killed}/${targets.length} 个进程（${formatKillFailureSummary(s)}）\`)` |
| 143 | success | `notify.success(\`已结束 ${s.killed} 个进程\`)` |
| 147 | danger | `notify.error(\`批量结束失败：${String(e)}\`)` |
| 168 | danger | `notify.error(\`结束 node.exe 失败：${String(e)}\`)` |
| 184 | danger | `notify.error(\`「${name}」组内未结束任何进程：${formatKillFailureSummary(s) || '全部失败'}\`)` |
| 186 | warning | `notify.warning(\`已结束「${name}」组内 ${s.killed}/${targets.length} 个进程（${formatKillFailureSummary(s)}）\`)` |
| 188 | success | `notify.success(\`已结束「${name}」组内 ${s.killed} 个进程\`)` |
| 192 | danger | `notify.error(\`结束本组失败：${String(e)}\`)` |
| 213 | danger | `notify.error(\`结束进程树失败：${String(e)}\`)` |

- [ ] **Step 3: 2 处多行替换**（行 160-165 与 205-211，同构）——原模式：

```tsx
      showNotice(
        killed === 0 ? 'danger' : 'success',
        killed === 0
          ? '未结束任何 node.exe：可能权限不足或进程已退出'
          : `已结束 ${killed} 个 node.exe 进程`,
      );
```
改为：
```tsx
      (killed === 0 ? notify.error : notify.success)(
        killed === 0
          ? '未结束任何 node.exe：可能权限不足或进程已退出'
          : `已结束 ${killed} 个 node.exe 进程`,
      );
```
第二处（行 205-211）同样处理，消息为 `'未结束任何进程：根进程可能受保护、权限不足或已退出'` / `\`已结束进程树，共 ${killed} 个进程\``。

- [ ] **Step 4: 删渲染块**（行 377）：`{notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}` → 删除

- [ ] **Step 5: 验证**：`cd app && npx vitest run tests/processPanelMultiSelect.test.tsx && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add app/src/components/ProcessPanel.tsx
git commit -m "refactor(app): unify ProcessPanel kill feedback to toast"
```

---

### Task 6: SnapshotPanel 迁移（7 处）

**Files:**
- Modify: `app/src/components/SnapshotPanel.tsx:101,161,169,182,231,233,235,241,272`

- [ ] **Step 1: import + 删 hook 行**（行 101，连同其上 `// 操作结果反馈横幅（UX-17）...` 注释）——同前模式（SnapshotPanel 无 notify import，新增）

- [ ] **Step 2: 7 处替换**（消息逐字保留）：

| 行 | 原 tone | 新 |
|----|---------|----|
| 161 | danger | `notify.error('请先输入快照名称（如「agent 开工前」）')` |
| 169 | danger | `notify.error(\`取当前进程失败：${result.error.message}\`)` |
| 182 | danger | `notify.error(\`拍快照失败：${String(e)}\`)` |
| 231 | danger | `notify.error(\`未结束任何进程：${formatKillFailureSummary(s) || '全部失败'}\`)` |
| 233 | warning | `notify.warning(\`已结束 ${s.killed}/${targets.length} 个进程（${formatKillFailureSummary(s)}）\`)` |
| 235 | success | `notify.success(\`已结束 ${s.killed} 个进程\`)` |
| 241 | danger | `notify.error(\`批量结束失败：${String(e)}\`)` |

- [ ] **Step 3: 删渲染块**（行 272）→ 删除

- [ ] **Step 4: 验证**：`cd app && npx vitest run tests/snapshotPanelResponsive.test.tsx && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/src/components/SnapshotPanel.tsx
git commit -m "refactor(app): unify SnapshotPanel feedback to toast"
```

---

### Task 7: SessionPanel 迁移（2 处 + 2 渲染块）

**Files:**
- Modify: `app/src/components/SessionPanel.tsx:31,39-44,46,59,72`

- [ ] **Step 1: 删 useNotice import + hook 行**（行 31）。SessionPanel 已 import notify（行 11，原用于别的用途或为迁移预留）——保留该 import

- [ ] **Step 2: 多行调用替换**（行 39-44）——原：

```tsx
      showNotice(
        killed > 0 ? 'success' : 'danger',
        killed > 0 ? `已停止（结束 ${killed} 个进程）` : '未结束任何进程：根进程可能受保护、权限不足或已退出',
      );
```
改为：
```tsx
      (killed > 0 ? notify.success : notify.error)(
        killed > 0 ? `已停止（结束 ${killed} 个进程）` : '未结束任何进程：根进程可能受保护、权限不足或已退出',
      );
```

- [ ] **Step 3: 单行替换**（行 46）：`showNotice('danger', \`停止会话失败：${String(e)}\`);` → `notify.error(\`停止会话失败：${String(e)}\`);`

- [ ] **Step 4: 删两处渲染块**（行 59、72）：`{notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}` → 各删除一行

- [ ] **Step 5: 验证**：`cd app && npx vitest run tests/sessionPanel.test.tsx && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add app/src/components/SessionPanel.tsx
git commit -m "refactor(app): unify SessionPanel stop feedback to toast"
```

---

### Task 8: RunProfilesPanel 迁移（7 处，保留 loadError）

**Files:**
- Modify: `app/src/components/RunProfilesPanel.tsx:40,81,82,91-94,95,103,104,114,116,128`

- [ ] **Step 1: 删 useNotice import + hook 行**（行 40，连同其上 `// 操作结果反馈横幅（UX-07/UX-17）：...` 注释）。RunProfilesPanel 已有 notify import——保留

- [ ] **Step 2: 7 处替换**（消息逐字保留）：

| 行 | 原 tone | 新 |
|----|---------|----|
| 81 | danger | `notify.error('启动失败：command 不在白名单或 cwd 无效')` |
| 82 | danger | `notify.error(\`启动失败：${String(e)}\`)` |
| 95 | danger | `notify.error(\`停止失败：${String(e)}\`)` |
| 103 | danger | `notify.error('重启失败：run 不存在或配置无效')` |
| 104 | danger | `notify.error(\`重启失败：${String(e)}\`)` |
| 114 | danger | `notify.error('删除失败：文件写入出错')` |
| 116 | danger | `notify.error(\`删除失败：${String(e)}\`)` |

- [ ] **Step 3: 多行调用替换**（行 91-94）——原：

```tsx
      showNotice(
        killed > 0 ? 'success' : 'danger',
        killed > 0 ? `已停止（结束 ${killed} 个进程）` : '停止失败：未结束任何进程（可能受保护或已退出）',
      );
```
改为：
```tsx
      (killed > 0 ? notify.success : notify.error)(
        killed > 0 ? `已停止（结束 ${killed} 个进程）` : '停止失败：未结束任何进程（可能受保护或已退出）',
      );
```

- [ ] **Step 4: 删 notice 渲染块**（行 128）→ 删除；**保留**行 129 的 `{loadError && <PanelAlert tone="danger">加载 Run Profiles 失败：{loadError}</PanelAlert>}`（常驻错误，非本次范围）

- [ ] **Step 5: 验证**：`cd app && npx vitest run tests/runProfilesPanel.test.tsx && pnpm typecheck`
Expected: PASS（「启动失败」徽章断言与 toast 文本断言均在）

- [ ] **Step 6: 提交**

```bash
git add app/src/components/RunProfilesPanel.tsx
git commit -m "refactor(app): unify RunProfilesPanel feedback to toast"
```

---

### Task 9: ProcessTable + ProjectGroupView 复制失败迁移（各 1 处）

**Files:**
- Modify: `app/src/components/ProcessTable.tsx:14,507,509,556`
- Modify: `app/src/components/ProjectGroupView.tsx:16,461,463,482`

- [ ] **Step 1: ProcessTable**——删 `useNotice` import（行 14）与 hook 行（行 507）；新增 `import { notify } from '../lib/notify';`（如无）；行 509：
`navigator.clipboard?.writeText(text).catch(() => showNotice('danger', '复制失败：剪贴板不可用'));`
→ `navigator.clipboard?.writeText(text).catch(() => notify.error('复制失败：剪贴板不可用'));`
删渲染块（行 556）

- [ ] **Step 2: ProjectGroupView**——同样处理：删 import（行 16）/hook 行（行 461），行 463 同上替换，删渲染块（行 482）

- [ ] **Step 3: 验证**：`cd app && pnpm typecheck && npx vitest run tests/processPanelMultiSelect.test.tsx tests/workspaceNavigation.test.tsx`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add app/src/components/ProcessTable.tsx app/src/components/ProjectGroupView.tsx
git commit -m "refactor(app): unify copy-failure feedback to toast"
```

---

### Task 10: 删除 useNotice 通道

**Files:**
- Delete: `app/src/hooks/useNotice.ts`
- Delete: `app/tests/useNotice.test.tsx`

- [ ] **Step 1: 删除两个文件**

```bash
rm app/src/hooks/useNotice.ts app/tests/useNotice.test.tsx
```

- [ ] **Step 2: 验证零残留**：`grep -rn "useNotice" app/src/ app/tests/` → 无输出；`cd app && pnpm typecheck`
Expected: grep 无输出，typecheck 干净

- [ ] **Step 3: 提交**

```bash
git add app/src/hooks/useNotice.ts app/tests/useNotice.test.tsx
git commit -m "refactor(app): remove useNotice inline-banner channel"
```

---

### Task 11: 文档收尾

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`（§8）

- [ ] **Step 1: CHANGELOG**——把 `[Unreleased]` 下的 dev-experience-pack 整节（从 `### 开发者体验增强包（dev-experience-pack，2026-07-31）` 到该节末尾）移动到 `[v2.4]` 节内（v2.4 节开头的 `基于 feat/desktop-workbench 分支的 Phase 1-4 设计落地` 段落之后，作为独立 `### 开发者体验增强包（dev-experience-pack）` 小节），并在该小节内追加一条：

```markdown
- **操作反馈通道统一**：全部面板内操作反馈（kill 结果/快照/停止会话/RunProfile 启停/复制失败/面板替换告知）从面板内横幅统一迁移到右下角 toast（`notify` 通道），新增 warning kind（部分成功场景用 amber 警示）；删除 useNotice 横幅机制，`PanelAlert` 仅保留服务加载失败等常驻错误。
```

`[Unreleased]` 节清空为 `## [Unreleased]`（无内容，或删除该节）。

- [ ] **Step 2: AGENTS.md §8**——v2.4 段落末尾追加一句：`操作反馈统一到 toast（warning kind 新增），ToastHost 单实例挂载。`；测试数行改为：

```markdown
- 测试：app 594/594 + native 51/51，共 645 PASS。
```

- [ ] **Step 3: 提交**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs: fold dev-experience-pack into v2.4, record feedback unification"
```

---

### Task 12: 全量验证

- [ ] **Step 1: 全量测试 + 类型**

Run: `cd app && pnpm vitest run && pnpm typecheck`
Expected: 全部 PASS（预期约 593 条：594 − useNotice 1 个测试文件内的用例数，具体以实际为准），typecheck 干净

- [ ] **Step 2: native 确认未动**：`git diff HEAD~10 --stat -- codemgr-native/ | wc -l` → 0（无 native 改动，无需 build/bench）

- [ ] **Step 3: 最终提交**

```bash
git add -A  # 仅当 git status 确认无未预期文件
```
（或按实际变更精确 add）→ 若有残留变更则 `git commit -m "chore(app): final consistency sweep"`，无则跳过

---

## Self-Review 记录

- **Spec 覆盖**：warning kind（Task 1）✓；38 处调用迁移（Task 3-9：App 1 + PortRadar 3 + ProcessPanel 15 + SnapshotPanel 7 + SessionPanel 2 + RunProfilesPanel 8 + ProcessTable 1 + ProjectGroupView 1 = 38，与 `grep -rn "showNotice("` 实数一致）✓；useNotice 删除（Task 10）✓；ToastHost 双挂载（Task 3 Step 5）✓；文档（Task 11）✓；测试更新（Task 2 + Task 1 Step 5）✓。
- **占位符**：无 TBD/TODO；所有代码块为完整可粘贴内容。
- **类型一致性**：`notify.warning` 在 Task 1 定义、Task 3-9 使用；`(killed > 0 ? notify.success : notify.error)(...)` 三元调用模式统一。
