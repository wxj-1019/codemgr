# Toast 通知系统设计（替换全部 alert/confirm）

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 P0-4

## 1. 问题

全仓库 40 处操作反馈用浏览器原生 `alert()`/`confirm()`（PortRadar/ProcessPanel/SessionPanel/SnapshotPanel/RunProfilesPanel/LabelRuleEditor）。在 Aurora 毛玻璃设计体系里弹原生对话框：①视觉出戏；②阻塞主线程且无法聚合批量结果；③`alert` 无分级（成功/失败一个样）。

## 2. 目标 / 非目标

**目标**
- 非阻塞、可堆叠、分级（success/error/info）的 Toast 通知，全部操作反馈统一走它。
- `confirm()`（2 处：LabelRuleEditor 导入替换、RunProfilesPanel 删除 profile）迁移到既有 ConfirmDialog。
- 为后续子项目（C 日志、D 端口守望、E 导出、F/G 反馈）提供统一通知出口。

**非目标（YAGNI）**
- 通知历史/中心、托盘系统通知（D 的端口守望复用 Toast 即可，不接 Windows 通知）。
- 悬停暂停计时、进度条、去重合并。

## 3. 设计

### 3.1 store（`app/src/store/toastStore.ts`）
```ts
interface ToastItem { id: number; kind: 'success' | 'error' | 'info'; message: string; durationMs: number }
```
- `push(kind, message): number`：生成自增 id 入栈；**栈上限 5 条**，超出丢弃最旧（shift）；按 kind 设定时器自动 dismiss（success/info 4000ms，error 8000ms）。
- `dismiss(id)`：移除并清定时器。
- **不 persist**（瞬态 UI 态，违反 §10.2 persist 白名单惯例属刻意）。
- 定时器句柄存模块级 Map（不进 state，避免序列化/重复渲染）。

### 3.2 非 React 出口（`app/src/lib/notify.ts`）
`notify.success/error/info(message)` → `useToastStore.getState().push(...)`。异步回调（kill 结果、IPC 错误）无法/use 不到 hook，统一从 lib 调。

### 3.3 组件（`app/src/components/ToastHost.tsx`）
- `createPortal` 挂 body，`fixed bottom-4 right-4 z-[70]`（高于 ContextMenu z-60），纵向栈，gap-2。
- 单条：`glass-elevated rounded-lg px-3 py-2 text-sm shadow-2xl` + kind 图标（success=CheckCircle2 绿、error=CircleX danger、info=Info accent）+ message + X 关闭 IconButton。
- 可访问性：success/info `role="status"`，error `role="alert"`。
- 挂载体：`App.tsx` 根渲染一次。

### 3.4 替换映射（40 处）
| 文件 | 现状 | 替换 |
|---|---|---|
| `lib/shellClient.ts` | 2 函数内 alert；函数名含 OrAlert | 改 notify.error；**重命名** `openTargetOrAlert→openTargetOrNotify`、`openExternalUrlOrAlert→openExternalUrlOrNotify`，同步 4 个调用文件（ProcessTable/ProjectGroupView/PortTable/ProcessDetailSidebar） |
| `PortRadar.tsx` | kill 失败 2 处 alert | notify.error |
| `ProcessPanel.tsx` | killByName/killByPids/批量结果 alert | 成功 notify.success、失败/部分失败 notify.error |
| `SessionPanel.tsx` | 停止会话 2 处 | notify.error |
| `SnapshotPanel.tsx` | 校验/保存/批量 kill 8 处 | 按语义 success/error |
| `RunProfilesPanel.tsx` | 启动/停止/重启失败 4 处 + 删除 confirm 1 处 | notify.error；confirm→ConfirmDialog |
| `LabelRuleEditor.tsx` | 导出/导入 6 处 alert + 1 处 confirm | alert→notify；confirm→ConfirmDialog（portal 后渲染于编辑器 modal 之上） |

复制类动作（cmdline/cwd/端口/PID）保持**静默**，不加成功 toast（避免噪音）。

## 4. 测试（TDD）

- `toastStore.test.ts`：push 自增 id/三 kind 时长映射/上限 5 丢弃最旧/dismiss 移除/fake timers 自动消失/error 不提前消失。
- `toastHost.test.tsx`：按 store 渲染条目与 kind 图标、点 X dismiss、error 条目 role=alert。
- 既有 424 测试不回归（LabelRuleEditor/SnapshotPanel 等测试若 stub alert 需改为断言 notify/store）。

## 5. 验收（人工）

1. 结束进程失败（如受保护进程）→ 右下角红色 toast，8s 自消，可手动关。
2. 批量结束 node.exe → 聚合结果一条 toast（不再连环弹窗）。
3. 标签规则导入 → ConfirmDialog 确认；成功/失败 toast 反馈。
