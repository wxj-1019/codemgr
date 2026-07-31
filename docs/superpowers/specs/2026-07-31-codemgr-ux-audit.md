# CodeMgr — 可用性审查报告（UX Audit Spec）

> 版本: v2.0 | 日期: 2026-07-31 | 状态: 已全部实施（2026-08-01）
> 实施情况: UX-01..UX-31 全部落地（六轮共 12+ 提交，app 测试 433→514）。
> 轮次: ①UX-05/06 Run Profiles 可靠性 ②UX-01/03/07/17 操作反馈 ③UX-12/16/18/24/31+回归
> ④UX-02/04/09/16/22/23 kill 枚举与可发现性 ⑤UX-13 分组虚拟化 ⑥UX-08/10/11/14/15/19/20/21/25/26/27/28/29/30 收官。
> 方法: 静态代码审查，三路并行（工作台布局 / 错误处理与数据流 / 核心面板交互），每路独立只读探索。
> 环境限制: 无法驱动 Electron GUI（无 BrowserWindow 自动化），结论**未经运行时验证**；每条发现附 `file:line` 证据，实施前需复现确认。

---

## 0. 结论摘要

**核心链路可用且稳，但"告知层"整体偏弱——能"用"，不够"顺畅"。**

- 做得好（无问题，勿动）：三个轮询面板错误处理闭环（失败不清数据、陈旧标记、可见性节流、busyRef/stoppedRef 防重入）、全部 kill 路径 ConfirmDialog + 聚焦取消 + busy 防连点、native 保护名单（`IsProtected`）、进程表选中/焦点 pid 锚定（排序过滤虚拟化下不丢）、preload 缺失防白屏、28 个 IPC 通道 26 个有 try/catch 降级。
- 三块短板（优化空间所在）：
  1. **危险操作信息供给**——确认框不列目标、保护名单不可见、失败原因三合一、成功零反馈；
  2. **Run Profiles 数据可靠性**——spawn 失败卡死、runs 状态不同步可重复启动同一服务、失败静默；
  3. **功能可发现性**——零 onboarding、3 面板静默替换、高级功能随 tile 宽度消失、破坏性操作无确认。

---

## 1. 范围与方法

### 1.1 审查范围

| 维度 | 覆盖 |
|------|------|
| 工作台布局 | `app/src/store/layoutStore.ts`、`activePanelStore.ts`、`focusStore.ts`、`components/workspace/`、`electron/main.ts` 窗口配置 |
| 错误与数据流 | `components/LoadState.tsx`、`ui/StateView`、`hooks/use*.ts`、`lib/ipc.ts`、全部 store、`electron/preload.ts`、`electron/main.ts` |
| 核心交互 | `PortRadar/PortTable`、`ProcessPanel/ProcessTable/ProjectGroupView/ProcessDetailSidebar`、`ContextMenu/ConfirmDialog/Dialog`、`lib/batchKill`、快照/Run Profiles/Session 面板、`codemgr-native/src/process_ops.cpp` |

### 1.2 排除项

- 非功能性体验（性能基线、内存）不在本审查范围（另有 bench 机制）。
- 视觉/主题（Aurora 轨道）不在本审查范围。
- 明确不竞争项（SI 深度能力）不构成问题。

---

## 2. 发现清单（按严重度）

> 编号 UX-01 起。P0 = 直接误导/误操作或状态不可信；P1 = 阻碍顺畅使用；P2 = 打磨项。

### 2.1 P0 — 危险操作安全与反馈

#### UX-01 批量/组/树杀确认框不列"到底杀谁"（高）

- 证据：批量杀确认只显示 `确定结束选中的 N 个进程吗？（主要进程名：X）`（`ProcessPanel.tsx:312-314`）；组杀只显示组名 + 数量（`:336-340`）；快照 added 批量杀只有数量（`SnapshotPanel.tsx:323`）；进程树确认无子孙数量（`ProcessPanel.tsx:351`）。
- 影响：高危动作无法核对目标，混选（多项目、含非预期进程）时误杀面不可控。
- 修法方向：确认框列出目标进程名清单（滚动列表，>N 显示"及另 M 个"），树杀显示子孙数量；全部复用现有 ConfirmDialog。

#### UX-02 保护名单对用户不可见（高）

- 证据：保护名单只在 native（`codemgr-native/src/process_ops.cpp:12-28`），渲染层 grep 无 `IsProtected` 引用——svchost/electron/CodeMgr 自身照常渲染"结束"按钮（`ProcessTable.tsx:219-240`、`ProcessDetailSidebar.tsx:365-378`）；事后失败文案三原因合并：`结束失败：受保护进程、权限不足或进程已退出`（`ProcessPanel.tsx:74`、`PortRadar.tsx:32`）。
- 影响：用户事前不知"这个不能杀"，事后无法区分三种失败原因（受保护=永远杀不掉 vs 权限=可提权 vs 已退出=无需处理），只能反复重试。
- 修法方向：IPC 增加逐 pid 失败原因枚举（protected / access-denied / exited / killed），native `KillByPids` 返回逐项结果；渲染层受保护行事前置禁用/角标。

#### UX-03 单杀成功零反馈（中）

- 证据：`doKill` 成功路径直接 `setPendingKill(null)` 静默关闭对话框（`PortRadar.tsx:26-41`、`ProcessPanel.tsx:67-82`）。
- 影响：成功与否全靠 2-3 秒后轮询行消失间接推断；PID 复用窗口内会误判"没杀掉"而重复操作。
- 修法方向：杀完在面板摘要/横幅回执"已结束 PID xxx（name）"。

#### UX-04 批量杀反馈只有计数，无逐项失败原因（中）

- 证据：`已结束 2/5 个进程（其余受保护/无权限/已退出）`（`ProcessPanel.tsx:88-105`）；native 只返回 killed 计数，三种失败原因在 C++ 层合并（`process_ops.cpp:31-55`）。
- 影响：用户无依据决定下一步（被保护的永远失败、已退出的无需处理）。
- 修法方向：依赖 UX-02 的逐 pid 原因扩展（同一 IPC 契约改动）。

### 2.2 P0 — Run Profiles 数据可靠性

#### UX-05 spawn 失败永久卡"运行中"（高）

- 证据：`runProfiles.ts:53-79` 只监听 `child.on('exit')`，**无 `child.on('error')`**——cwd 被删/命令不存在只触发 error 不触发 exit，`RUN_UPDATE` 永不推送 exited，UI 永久显示"PID x · 启动中/运行中"。
- 影响：用户误信服务在跑；无任何提示。
- 修法方向：补 `on('error')` → 推送 failed 状态 + 错误文案。

#### UX-06 runs 状态无初始/重挂载同步，可重复启动同一服务（高）

- 证据：`useRunProfiles.ts:10-14` 只做"挂载时 list + 订阅事件"，无 `allStates` 初始同步通道（`ipc-types.ts:287-293` 无对应通道）；面板关闭期间 run 退出事件丢失 → 重开面板显示陈旧"运行中"；app 重启后 main 的 RunManager 还活着的服务 UI 显示未运行 → **可对同一服务重复启动第二个实例**（端口冲突）。
- 影响：重复实例/端口冲突，Dev 工作流最怕的场景。
- 修法方向：main 侧新增 `getRunStates()` 全量同步通道，面板挂载时拉取 + 事件增量合并。

#### UX-07 删除/停止失败静默 + unhandled rejection（高）

- 证据：删除 `await ipc.deleteRunProfile(profileId); await refreshProfiles();` 无 try/catch、不检查返回 false（`RunProfilesPanel.tsx:54-58`）；停止忽略返回值，而 `stopProfile` 返回 killTree 实际杀掉的进程数（`main.ts:483-486`、`runProfiles.ts:81-85`），根进程受保护时返回 0 → 点"停止"毫无反应且状态徽章不变。
- 影响：操作失败无任何反馈。
- 修法方向：try/catch + 返回值检查 + 失败文案（复用 Dialog/横幅）。

### 2.3 P1 — 可发现性与工作台

#### UX-08 零 onboarding，首屏单面板，核心能力零引导（中-高）

- 证据：默认布局 `classic: 'process'` 单面板（`layoutStore.ts:296`、`:134`）；全库 grep `onboard|welcome|firstRun|引导|教程` 无命中；6 面板（`panelCatalog.tsx:45-82`）+ 3 预设（`layoutStore.ts`）零引导。
- 影响：新用户只看到进程表，不知道端口雷达/性能/快照/Run Profiles/多面板存在。首屏信息完整（不空白）但不引导。
- 修法方向：首启轻量引导（欢迎条/侧栏入口高亮/一次性提示），不做 tour 也可。

#### UX-09 3 面板满员时打开第 4 个静默替换活跃 tile（中-高）

- 证据：`MAX_VISIBLE_PANELS = 3`（`layoutStore.ts:44`），满员后 `replacePanelLeaf` 直接替换活跃叶（`:109-129`），无 toast/确认/撤销；唯一反馈是顶栏计数（`WorkspaceTopbar.tsx:46`）；活跃 tile 仅靠 `panel-active` 辉光描边（`Panel.tsx:23`）。
- 影响："我的面板/数据消失了"的困惑；被替换面板局部状态（编辑中、选中态）丢失。
- 修法方向：替换时 toast"已用 X 替换 Y"；可选"最近关闭"恢复列表；加强活跃 tile 标识。

#### UX-10 精确 cwd / Git / 环境变量 / 诊断随 tile 宽度 <720px 整块消失（中）

- 证据：详情侧栏仅 tile ≥720px 渲染（`ProcessPanel.tsx:28`、`:398-400`），侧栏内"读取精确工作目录"（`ProcessDetailSidebar.tsx:256`）、Git 身份、环境变量、诊断上下文全部随之消失；3 面板布局下每 tile 约 350px，主场景下高级功能不可达且无提示。
- 影响：多面板用户（产品主场景）失去全部进程详情能力。
- 修法方向：窄 tile 降级——入口按钮弹出 Dialog 版侧栏，或侧栏改浮层。

#### UX-11 布局预设是破坏性操作且无确认，入口权重与能力不匹配（中）

- 证据：`applyPreset` 直接 `set({ root: LAYOUT_PRESETS[id] })` 覆盖手动布局，无确认、不可撤销（`layoutStore.ts:300`）；入口是侧栏底部 11px 小 select（`WorkspaceSidebar.tsx:179-195`），选项无内容描述。
- 影响：手动排好的布局一键被覆盖；多面板能力入口最不易发现。
- 修法方向：预设应用加确认；选项加描述文案；入口上移或改按钮组。

#### UX-12 持久化异常全部静默回退，同版本损坏无校验（中）

- 证据：`sanitizeLayoutRoot`/`limitVisiblePanels` 只在 migrate（版本变化）时执行（`layoutStore.ts:218-236`）；v2 数据可解析但结构非法时无校验直接进 Mosaic（`renderPanel` 未知 id 返回 null → 空白 tile，`panelCatalog.tsx:119-121`）；无 `onRehydrateStorage` 兜底（对比 `themeStore.ts:35`、`labelRulesStore.ts:158`）；插件叶子清理静默（`:272-291`）。
- 影响：布局被重置/空白 tile 后无感知，问题难归因。
- 修法方向：`onRehydrateStorage` 里做 v2 结构校验 + 提示"布局已重置"；非法 root 回退默认。

### 2.4 P1 — 性能

#### UX-13 项目分组视图无虚拟化且 GroupRow memo 被击穿（中）

- 证据：虚拟化只在 ProcessTable（`ProcessTable.tsx:74, 391-397`）；ProjectGroupView 全量渲染（`ProjectGroupView.tsx:422-451`），GroupRow memo 因 props 含整个 cpuMap + 每轮新引用的 selectedPids Set 被击穿（`:437-438`），2s 轮询全量重渲染。
- 影响：>100 进程的项目视图（300 个 node 同组）卡顿；**与设计文档 §3.2">100 进程启用虚拟滚动"承诺矛盾**。
- 修法方向：分组视图复用虚拟化；memo 依赖收敛（cpuMap 改按行取、selectedPids 改稳定引用）。

#### UX-14 CPU 实时排序导致行序每 2 秒重排（中）

- 证据：排序作用于 filtered 全量，cpu 值 2s 轮询更新（`ProcessTable.tsx:294-319`）。
- 影响：按 CPU 排序时行漂移，瞄准"结束"按钮时行已换位；虚拟列表不跟随滚动。
- 修法方向：排序视图下冻结排序（暂停列更新）或最小变化间隔/变化量阈值。

### 2.5 P2 — 体验打磨

| # | 问题 | 证据 | 修法方向 |
|---|------|------|---------|
| UX-15 | ErrorBoundary 仅根级，任一面板崩溃 = 整应用错误屏且"重试"对持续错误无效 | `main.tsx:12-17` | 面板级 ErrorBoundary 隔离 |
| UX-16 | Session/RunProfiles 误导性空态：首帧 processScan 未完成即显示"未检测到 AI 开发会话"；列表加载失败显示"尚无 Run Profile" | `useSessions.ts:13-15`、`useRunProfiles.ts:11`、`SessionPanel.tsx:45-53`、`RunProfilesPanel.tsx:70-73` | 补 loading 态；加载失败与真空态区分 |
| UX-17 | 原生 alert/confirm 残留（Phase 4 已有 Dialog 体系） | `RunProfilesPanel.tsx:35-55`、`SnapshotPanel.tsx:155-176`、`PortRadar.tsx:30-33` | 迁移到 Dialog/横幅 |
| UX-18 | 进程 → 端口无联动：侧栏已取 connections 却不展示该进程监听端口 | `ProcessDetailSidebar.tsx:24` | 侧栏展示"该进程监听的端口"块 |
| UX-19 | 端口雷达"仅监听/仅占用"切换缺失——设计文档 §3.1 承诺 `[仅监听][仅占用]`，实现硬编码只渲染 listen-like | `PortTable.tsx:15`、`portFilter.ts:5-8` vs 设计文档 §3.1 | 补切换控件（实现 vs 设计缺口） |
| UX-20 | 冲突高亮不指明冲突对方；过滤后只剩孤立红端口 | `PortTable.tsx:87-95`、`portFilter.ts:28-45` | tooltip 列冲突 PID；摘要加冲突计数 |
| UX-21 | 多选表头无 indeterminate 半选态、无反选；摘要"N 个监听端口"随过滤词变化误导 | `ProcessTable.tsx:548-566`、`PortRadar.tsx:43-53` | 半选态 + 反选 + 摘要改"匹配 N 个" |
| UX-22 | 复制命令行三处静默失败 | `ProcessTable.tsx:373-375`、`ProjectGroupView.tsx:359-361`、`ProcessDetailSidebar.tsx:227-230` | 失败提示 |
| UX-23 | 单杀确认文案两面板不一致（一个含"子操作将被中断"，一个没有） | `PortRadar.tsx:118` vs `ProcessPanel.tsx:301` | 统一话术 |
| UX-24 | 快照"定位"在进程面板不可见时零反馈 | `SnapshotPanel.tsx:603-609` | 激活/打开进程面板或提示 |
| UX-25 | PortTable 键盘焦点索引不随数据重置，过滤后焦点环消失 | `PortTable.tsx:20-31` | 数据变化重置 focusedIdx |
| UX-26 | 轮询 effect 重跑竞态：stoppedRef/busyRef 复位，旧 in-flight 可写新周期（三 hook 同构） | `usePortRadar.ts:28-29, 38` | 请求序号/世代计数 |
| UX-27 | 单次短暂失败横幅仅存一个轮询周期，用户可能错过 | `portRadarStore.ts:34` | 保留"上次出错时间" |
| UX-28 | PerfPanel 有数据后错误细节被吞（只显示"数据陈旧"） | `PerfPanel.tsx:64-68` | 显示错误原因 |
| UX-29 | GPU% 列在 perf 面板未打开时显示"—"且提示隐晦 | `ProcessTable.tsx:596` | 明确文案"性能面板未开启" |
| UX-30 | 侧栏无法看出哪些面板已打开（除活跃项）；「只保留当前面板」用 Maximize2 图标语义误导；「标签规则」用齿轮图标（Settings 误导）；「Run Profiles」唯一英文标题无 hover 说明；布局 select 无选项描述 | `WorkspaceSidebar.tsx:70-101, 179-199`、`WorkspaceTopbar.tsx:31-35`、`panelCatalog.tsx:77` | 图标/文案/说明统一 |
| UX-31 | 「将在下次轮询时自动重试」在 pollMs=0（暂停）时不成立 | `LoadState.tsx:24` + hooks `if (pollMs <= 0) return` | 暂停时文案区分 |

---

## 3. 落地建议顺序

1. **Quick wins（纯前端，改动小见效快）**：UX-03 单杀反馈、UX-17 原生 alert 迁移、UX-18 进程→端口联动、UX-19 监听切换、UX-20 冲突对方、UX-21 半选态、UX-22 复制反馈、UX-12 持久化校验提示。
2. **数据可靠性（Run Profiles）**：UX-05 `on('error')` 监听 → UX-06 allStates 同步通道 → UX-07 失败反馈。消除"服务状态不可信"。
3. **危险操作**：UX-01 确认框列清单（纯前端）→ UX-02/UX-04 逐 pid 失败原因（动 native/IPC 契约，最重）。
4. **可发现性**：UX-08 首启引导、UX-09 替换提示/最近关闭、UX-10 窄 tile 降级、UX-11 预设确认。
5. **性能**：UX-13 项目分组虚拟化（与 ProcessTable 同模式）、UX-14 排序冻结。

优先级逻辑：先消除"操作后不知道发生了什么"与"服务状态不可信"（1、2），再做危险操作信息供给（3），最后引导与性能（4、5）。

---

## 4. 成功标准（若实施）

- 每条 UX 项实施时附回归测试（纯逻辑走 TDD；UI 人工验收）。
- 预提交钩子增量测试通过；`cd app && pnpm typecheck` 绿。
- 既有 IPC 形状在 1/2/4 阶段保持不变；3 阶段变更需同步 `ipc-types.ts` + preload + main + `lib/ipc.ts` 四件套（§10.1 接线清单）。
- 行为回归约束：默认状态（单面板 classic、无多选、无过滤）下零回归。

---

## 5. 关联文档

- 设计定位：`2026-07-29-codemgr-design.md`（§3.1 端口雷达设计承诺 = UX-19 缺口来源；§3.2 虚拟滚动承诺 = UX-13）
- 工作台：`2026-07-30-codemgr-desktop-workbench-design.md`、`2026-07-30-codemgr-desktop-workbench-remainder.md`
- 采集失败语义（A2，错误链路的既有成果）：`2026-07-30-codemgr-a2-collector-failure-semantics.md`
- Run Profiles（F1）：`2026-07-30-codemgr-f1-run-profiles.md`
- 目标用户画像（判据"谁会用、多久用一次"）：`2026-07-29-codemgr-design.md` §1.4
