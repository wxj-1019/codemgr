# Changelog

本文件记录 CodeMgr 所有面向用户的变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [v2.4] — 2026-07-30

### 桌面工作台（Apple × Codex Desktop Workbench）
基于 `feat/desktop-workbench` 分支的 Phase 1-4 设计落地。把 CodeMgr 的 UI 骨架从「mosaic 顶部 nav」升级为「Apple × Codex 工作台」：workspace 侧栏导航 + 设计系统 + 统一面板 chrome + 响应式 tile + portal 浮层。

#### Phase 1：工作台骨架（shell + 设计系统 + 布局引擎）
- **workspace shell**：Codex 式侧栏（`WorkspaceSidebar`：监控组/工作流组/扩展组）+ 顶栏（`WorkspaceTopbar`，`app-region: drag`）+ `panelCatalog`（6 内置面板 + 插件描述符的单一真相源）。
- **设计系统**：语义令牌（`surface/canvas/panel/raised/overlay`、`content/primary/secondary/muted`、`line/focus/success/info/danger/warn/on-accent`）+ Tailwind `<alpha-value>` + 亮/暗双主题（root `.dark`/`.light` 早于 createRoot 挂载）。lucide-react 图标经 `icons.tsx` facade。UI 原语：`Button`（4 variant/3 size）、`IconButton`、`Badge`（6 tone）、`StateView`、`PanelActionBar`、`PanelAlert`。`kindStyles.ts` 集中进程 kind→Badge tone 映射。
- **布局引擎**：`layoutStore` 的 `openPanel`（幂等：存在→激活，缺席→70/30 行拆，空→叶根）+ preset（手动重排后清空，apply 时恢复）+ persist v1（v0 迁移 + preset 同步校验 + DFS 去重）+ 活跃面板协调（关闭回退首叶）。

#### Phase 2：面板 chrome 统一
6 内置面板去掉内部 `<h1>`（mosaic 标题栏为唯一标题），header→`PanelActionBar`（eyebrow+summary+actions）。emoji 按钮→`IconButton`+lucide（✕→X、↻→RefreshCw、📸→Camera）。硬编码色→语义令牌/Badge（SessionPanel fuchsia→Badge(accent)、cyan→accent、red→danger quiet；RunProfilesPanel green/amber/red→success/warn/danger）。PerfPanel 11 处重复 surface→共享常量。ProcessTable 空状态/虚拟 spacer colSpan 8→9（实际 9 列）。PluginPanel `bg-base-panel`（无效类）→`bg-surface-panel`。

#### Phase 3：响应式 tile
`useContainerWidth` hook（ResizeObserver 测容器宽度）。`.panel-container` 加 `container-type: inline-size`（容器查询上下文）。ProcessPanel 删 `useIsLg(matchMedia 1024px)`→`useContainerWidth(panelRef)`，侧栏 ≥720px 才显示（**核心**：多面板布局下按 tile 宽度而非窗口宽度）。SnapshotPanel 在 `<480px` tile 改为顶部紧凑选择/创建条，避免 diff 区被固定侧栏挤窄；面板操作条在窄 tile 自动换行，搜索控件随剩余宽度收缩。

#### Phase 5：桌面交互收口
- Workspace shell 合并重复 CSS，保留 Windows 原生标题栏 152px 安全区；侧栏收窄到 180px，面板名称修复 Button grid 收缩导致的裁剪并真正左对齐，窄 rail 仍可访问布局预设。
- 端口/进程表补初始 Tab 入口、完整滚动链和虚拟列表兼容；`Panel` 与各面板统一 `min-height: 0` 高度链，进程/项目分组/性能/快照/会话/Run Profiles 可完整滚动。进程详情侧栏完全按 tile 宽度显示，跨面板聚焦时无需 checkbox 选中。
- Snapshot 空/加载状态统一 `StateView`，删除迁移到 `ConfirmDialog`，差异 tabs 补 ARIA 语义；Mosaic 控件补 focus-visible 与 reduced-motion 规则。
- Renderer IPC 薄封装在 preload API 缺失时返回可捕获错误/空订阅，避免浏览器调试或 preload 加载失败直接白屏。
- 修复 Mosaic 激活包装层截断窗口满高继承：进程面板点击放大后正文、表格和详情区域不再塌缩消失。
- 进程面板新增显式「多选」模式：默认点击/键盘操作只聚焦进程并打开详情；进入模式后才显示复选框、支持可见行批量选择和批量结束。树表与项目分组保持一致，详情焦点与批量选择独立。

#### Phase 6：聚焦工作区
- 同时可见面板上限为 3：第二个面板沿用 70/30 主次布局，第三个在当前活跃 tile 下方 50/50 堆叠，避免三列窄窗；打开第 4 个未打开面板时替换当前活跃 tile，插件面板遵守同一规则。Mosaic 在 3 面板时不再提供 Split/Replace，避免标题栏重新制造拥挤布局。
- 顶栏显示当前面板数量；多面板时提供「只保留当前面板」图标操作，一键回到专注单面板。
- 布局持久化升级到 v2，旧 v1 自定义布局升级时按 DFS 收敛为前三个面板并折叠退化分支。

#### Phase 4：portal 浮层
`ui/Dialog`（新）：createPortal 到 document.body + focus trap（Tab 循环）+ Escape（非 busy）+ 焦点恢复 + aria-modal/aria-labelledby。ConfirmDialog/DiagnosticPreview/RunProfileEditor 迁移到 Dialog。ContextMenu 加 portal。决策：LabelRuleEditor 保留现状（已有完整 focus trap，迁移收益边际且双重 trap 有冲突风险）；App 插件下拉迁移留后续。

#### 视觉打磨轨道合并（2026-08-01，并行会话）
- **Toast 通知系统**：`toastStore` + `ToastHost` 取代全部原生 alert（success/info/warning 4s、error 8s、栈上限 5），含 LabelRuleEditor 导入导出反馈（Phase 4 决策的例外项至此收口）。操作反馈统一走右下角 toast，面板内横幅（useNotice）机制已删除。
- **Aurora token 迁移清零**：全仓库零遗留旧 token（`bg-base-*`/`text-fg-*`），含 ProcessTable/PortTable/ConfirmDialog 等最后一批。
- **Button 原语统一**：ConfirmDialog 等手写按钮迁移到 `ui/Button`（variant/size/busy 体系）。
- **设计系统统一**：3 级圆角体系（8/14/999px）、表格间距统一、面板阴影、hover 过渡与 focus ring 参数统一、玻璃 blur 参数统一、布局 CSS 变量抽取。
- **PerfPanel 玻璃升级 + LoadState→StateView**：错误/加载/空态统一走 `StateView`（LoadState 移除，其"自动重试"文案不再承诺——UX-31 的"暂停时承诺不存在"问题随迁移自然消除）。

#### Run Profiles 可靠性修复（UX-05/UX-06，2026-07-31）
- **spawn 失败不再永久卡「运行中」**：命令不在 PATH / cwd 被删等只触发 `error` 事件（不触发 `exit`），此前 run 状态永远停在 running。新增 `error` 监听 → run 置「启动失败」终态并携带错误原因；面板显示失败徽章（hover 见原因），失败后可直接重新启动。exit/error 双事件加终态守卫，错误信息不会被后到的 exit 覆盖。
- **run 状态全量同步，杜绝重复启动同一服务**：面板关闭重开/应用重启后，面板关闭期间 run 退出的事件会丢失，UI 显示陈旧的「运行中」，可对同一服务重复拉起第二个实例（端口冲突）。新增 `run:getStates` 全量同步通道，面板挂载时「先订阅事件 → 拉快照 → 按序重放快照在途事件」，事件零丢失；快照拉取失败也重放缓冲事件并切直连。

#### 操作反馈与危险操作确认（UX-01/UX-03/UX-07/UX-17，2026-07-31）
- **kill 确认框列出目标进程清单**：批量结束/结束本组/快照 added 批量结束的确认框新增目标明细（名称 + PID，超 15 条折叠为「…及另 N 个进程」），高危动作可核对「到底杀谁」。
- **操作结果反馈横幅取代原生 alert**：全部 kill 路径（单杀/批量/全杀 node/组杀/进程树）与 Run Profiles（启动/停止/重启/删除）、快照（拍摄/批量结束）的操作结果改为面板内自动消失的反馈横幅（成功/部分成功/失败三态），不再弹原生 alert——单杀成功终于有明确回执，不再靠轮询间接推断。
- **Run Profiles 删除/停止不再静默**：删除迁移到 ConfirmDialog（原生 confirm 移除），失败（文件写入出错）有反馈；停止按 killTree 实际结束数反馈——结束 0 个（受保护/已退出）明确提示，成功显示「已停止（结束 N 个进程）」；启动/重启失败反馈取代原生 alert。

#### 审查迭代第三批（UX-12/UX-16/UX-18/UX-24/UX-31 + 回归修复，2026-07-31）
- **修复：重试成功后旧「启动失败」徽章永久残留 + runs 无界增长**——native 侧同 profile 再启动时清理旧终态 run（failed/exited），面板侧仅当无运行中实例时才展示失败徽章。
- **AI 会话面板补漏（UX-16/UX-17）**：进程扫描未完成时显示「正在扫描进程…」不再误报「未检测到」；停止会话路径迁移到反馈横幅（含结束数量），原生 alert 全库清零（LabelRuleEditor 按 Phase 4 决策除外）。
- **进程→端口联动（UX-18）**：详情侧栏新增「监听端口」行——该进程正在监听的端口（地址:端口 + 协议）直接可见，不必跳端口雷达再搜 PID。
- **快照定位不再"点了没反应"（UX-24）**：进程面板不在当前布局时点击「定位」自动打开进程面板并聚焦。
- **暂停轮询时错误文案不再说谎（UX-31）**：LoadState 在 pollMs=0 时显示「轮询已暂停，恢复后自动重试」，替换不会发生的「将在下次轮询时自动重试」。
- **布局持久化同版本损坏兜底（UX-12）**：rehydrate 时校验布局树结构（未知面板 id/坏分支回退默认并留控制台线索），不再静默产出空白 tile。
- **小修**：ContextMenu 菜单项 hover 高亮同色不可见（raised→overlay）；三处 accent 按钮白字对比度不足（text-white→text-on-accent）；`resolveServiceStatus` 对 failed 状态不再误入端口判定；测试 mockIpc 补齐全部通道防漂移。

#### kill 失败原因枚举（UX-02/UX-04，2026-07-31）
- **native 逐 pid 结果**：`killByPids` 从"结束数量"升级为 `{pid, status}` 数组，`killProcess` 从布尔升级为状态字符串——四种结果：`killed / protected / denied / not-found`（受保护 / 权限不足 / 进程已退出逐一区分，不再三合一）。`killTree` 仍返回计数（内部复用详细实现求和）。
- **反馈文案分原因**：单杀失败显示"受保护进程，无法结束 / 权限不足（可能需要以管理员身份运行）/ 进程已退出"；批量杀按原因计数展示（如「已结束 3/5 个进程（受保护 1 · 已退出 1）」）；全部失败时明确列出原因组合。`summarizeKillOutcomes` / `formatKillFailureSummary` 纯函数。
- **3 面板满员替换不再静默（UX-09）**：打开第 4 个面板时顶栏下横幅提示「已用 X 替换 Y（最多 3 个面板）」，`replacedPanelOf` 纯函数与布局引擎共用同一替换目标选择逻辑。
- **Run Profiles 列表加载失败不再误报「尚无配置」（UX-16 补）**：失败显示错误横幅并记录 loadError，成功自动清除。
- **复制命令行有反馈（UX-22 补）**：详情侧栏复制成功显示「已复制」、失败显示「复制失败」（1.5s 恢复），不再静默吞掉。
- **单杀确认文案统一（UX-23）**：端口雷达与进程面板同一话术。

#### 项目分组视图虚拟化（UX-13，2026-08-01）
- **补上设计文档 §3.2 承诺缺口**：项目分组视图 >100 行启用虚拟滚动（与 ProcessTable 同阈值、同 overscan），300 个 node 同组不再整组铺进 DOM——此前每 2s 轮询全量重渲染，超大组直接卡顿。
- **修复 GroupRow memo 击穿**：行组件改为只收原始类型 props（组头行/进程行拆分 memo 化），动态值（CPU%、选中态）改为行内 zustand selector 按行订阅——轮询时只有值变化的那一行重渲染，不再整表重绘。扁平行模型只在分组/展开变化时重建。
- **键盘导航虚拟化感知**：焦点行未渲染时走 `virtualizer.scrollToIndex` 兜底（pending fallback + 渲染后补 focus，与 ProcessTable 同模式），ArrowDown/Up/Home/End 在 300 进程分组下依旧可用；全局聚焦（端口/快照点击定位）同样按行索引滚动。
- ProcessPanel 三个 kill 回调 useCallback 稳定化，补齐 memo 链路（父组件每轮轮询重渲染不再击穿行 memo）。

#### 审查迭代收官批（UX-08/10/11/14/19/20/21/22/25/26/27/28/29/30，2026-08-01）
- **首启引导（UX-08）**：首次启动顶栏下显示一次性欢迎条（6 面板 + 侧栏入口 + 布局预设），关闭后写 localStorage 不再打扰。
- **窄 tile 详情降级（UX-10）**：tile <720px 侧栏隐藏时，进程面板操作栏出现「详情」按钮——以对话框复用同一详情侧栏，精确 cwd/Git/环境变量/诊断在多面板布局下不再不可达。
- **布局预设覆盖确认（UX-11）**：当前是自定义布局时应用预设需确认（不再静默覆盖手动排布）；预设为当前布局时直接应用不打断。
- **CPU/GPU 排序冻结（UX-14）**：按 volatile 列排序时快照进入时的顺序，轮询期间数值实时刷新但行序稳定（点击目标不漂移）；再次点击同列或换列才重排。
- **端口雷达"仅监听/全部连接"切换（UX-19）**：补上设计文档 §3.1 承诺的切换；摘要计数随模式切换（"N 个监听端口" vs "N 个连接"），不再随过滤词误导。
- **冲突 tooltip 指明对方（UX-20）**：冲突端口悬停显示「也正被 PID x, y 监听」（`conflictHolders` 纯函数）。
- **多选表头半选态（UX-21）**：进程表/项目分组视图部分选中时全选框呈 indeterminate，不再空框误导。
- **复制失败反馈（UX-22 补）**：进程表/项目分组右键复制失败显示「复制失败：剪贴板不可用」横幅，不再静默吞掉。
- **端口表焦点钳制（UX-25）**：数据收缩（过滤/轮询）后键盘焦点索引收敛到合法范围，焦点环不凭空消失。
- **轮询世代计数（UX-26）**：三个轮询 hook 增加世代守卫——effect 重跑（切换 pollMs/可见性）时旧 in-flight 结果不再写入新周期。
- **错误横幅保留窗口（UX-27）**：短暂采集失败恢复后横幅保留 60s（「上次刷新出错（已恢复）」），不再一闪而过；关闭按钮可彻底清除。
- **PerfPanel 错误细节（UX-28）**：有数据后出错显示错误详情横幅（此前只显示「数据陈旧」）。
- **GPU 列提示（UX-29）**：无 GPU 数据时「—」悬停解释「性能面板未开启或无 GPU 数据」。
- **侧栏图标/文案（UX-30）**：Run Profiles →「运行配置」；「标签规则」齿轮图标 → ListChecks（不再误导为设置）；「只保留当前面板」Maximize2 → Focus；布局预设选项带内容描述（单面板/双面板/三面板）。
- **面板级错误边界（UX-15）**：每个面板 tile 包一层 ErrorBoundary（自定义降级 UI + 重试）——单面板渲染崩溃不再整应用错误屏，其余面板保持可用。至此 UX-01..UX-31 全部落地。

### 开发者体验增强包（dev-experience-pack，2026-07-31）

- **开发者跳转动作闭环**：进程右键菜单/详情侧栏/项目分组行新增「打开所在文件夹 / 在终端打开（wt 优先回退 cmd）/ 在编辑器打开（VS Code）/ 复制工作目录」；端口表新增右键菜单（在浏览器打开/定位到进程/复制端口/复制 PID/结束进程）与 TCP 监听行「在浏览器打开」按钮。shell 动作经 main 侧白名单校验（kind/绝对路径/http(s) scheme），渲染层不可构造任意命令。
- **Toast 通知系统**：全部操作反馈（kill 结果/快照/标签规则导入导出/RunProfile 启停/shell 打开失败）从原生 `alert`/`confirm` 迁移为非阻塞 toast（右下角堆叠上限 5 条，success/info 4s、error 8s 自动消失，可手动关闭，error 用 `role="alert"`）；标签规则「导入替换」与 RunProfile「删除」改用 ConfirmDialog。
- **RunProfile 日志闭环**：启动的开发服务 stdout/stderr 按 run 捕获进 ring buffer（2000 行上限，退出后保留，ANSI 转义剥离）；profile 行可展开日志视图（2s 增量拉取、跟随滚动、丢弃行数提示、本地清空）。新增 `run:getLogs` IPC 通道。
- **服务守望与就绪跳转**：RunProfile 服务状态跃迁主动通知（就绪 success / 端口冲突 error 含占用 PID，状态不变不重复）；服务就绪后行内出现「在浏览器打开」按钮一键访问。
- **数据导出**：进程面板与端口雷达新增「导出」按钮，当前过滤视图可导出 CSV（Excel 兼容 CRLF）或 JSON；文件路径经 main 保存对话框（文件名白名单校验 + 10MB 上限），导出结果 toast 反馈。新增通用 `config:exportDataFile` IPC 通道。
- **环境变量对比**：进程面板恰好选中 2 个进程时可「对比环境变量」，弹窗展示值不同/仅 A 有/仅 B 有三组差异（Windows env 键大小写不敏感，保留原大小写显示）。
- **启动项管理**：新「启动项」面板（workflow 组）列出 HKCU/HKLM Run 注册表项与启动文件夹项；HKCU 与文件夹项可逆禁用/恢复（备份键搬移 / `.codemgr-disabled` 后缀，不删数据），HKLM 系统级项只读。新增 `startup:list`/`startup:setEnabled` IPC 通道。
- **项目分组视图对齐树形视图能力**：组级按项目名/合计内存排序、组内进程按名称/CPU%/内存/PID 排序（点击表头切换）；总行数 >100 启用虚拟滚动（组头与进程行混合窗口化）。
- **一致性收尾**：进程 kind 配色收敛为 `lib/kindColors` 单处定义（原三处重复）；`lib/processFilter` 抽出共享（表格过滤与导出入口）；PLUGINS.md 头部滞后声明与 CONTRIBUTING roadmap 按实际发布修正（自定义列/排序预设评审后决策不做）。
- **操作反馈通道统一**：全部面板内操作反馈（kill 结果/快照/停止会话/RunProfile 启停/复制失败/面板替换告知）从面板内横幅统一迁移到右下角 toast（notify 通道），新增 warning kind（kill 部分成功、面板满员替换用 amber 警示）；删除 useNotice 横幅机制，PanelAlert 仅保留服务加载失败等常驻错误；修复 ToastHost 双挂载（main.tsx 单实例）。

### 测试
- app 308→433（新增 layoutStore 聚焦上限/持久化迁移、WorkspaceTopbar 聚焦操作、Mosaic 放大高度链、进程多选模式，以及工作台 Phase 1-6 回归），全过。dev-experience-pack 合流后 app 517/517（并集）→ 操作反馈统一后 593/593；native 49/49 → 51/51。当前共 644 PASS。
- **修复**：`codemgr-native/scripts/build.mjs` 的 CMake 发现逻辑——`vswhere -latest` 只取最新 VS 实例，若其无 CMake 组件（如只装 BuildTools）会失败回退 PATH。改为：最新实例无 CMake 时遍历**所有** VS 实例找第一个带 CMake 的（如本机 VS2022 BuildTools 无 CMake → 回退到 VS2019 Community）。

---

## [v2.3] — 2026-07-30

本版本把 CodeMgr 从「进程观察 + 清理工具」升级为「AI 开发者工作台」：补齐 workspace 身份、跨面板聚焦、诊断导出、AI 会话图谱、受控启动与服务健康检测，形成完整闭环。同时完成 Aurora 视觉重设计。

### 新增 — AI 开发工作流闭环（A1–F2）

- **A1 bug 修复包**（4 个纯前端 bug）：进程排序被 buildTree 覆盖失效；全选误选折叠隐藏的子进程（数据损失风险）；同名 worktree key 冲突；快照 changed 被内存波动淹没。全部 TDD 修复。
- **A2 采集失败语义**：轮询采集（进程/端口/性能）引入 `CollectResult<T>` 判别联合，取代"失败返回空数组"的降级。失败时**保留上次成功数据**并标注"数据陈旧（N 秒前）"，不再清空表格误导用户。
- **B Workspace Git 身份**：进程详情侧栏「解析 Git 身份」按钮，从 cwd 向上找 `.git`，解析 branch/HEAD/worktree。纯 fs 文件解析（不 spawn git、不进 native、不进热路径）。非 git 目录显示"非 Git 仓库"。
- **C 全局聚焦上下文**：新增全局 `focusedPid`，端口行/GPU Top5/快照 diff 项点击后定位到进程表（高亮 + 滚动），详情侧栏跟随焦点。与进程表多选（批量结束）独立共存。聚焦进程退出自动清空。
- **D 诊断上下文导出**：进程详情侧栏「复制诊断上下文」一键聚合脱敏 Markdown（进程身份/cwd/Git/端口/资源/父进程链/环境变量 key），预览后复制到剪贴板，便于粘贴给 AI 助手排障。环境变量值统一掩码（敏感 key `[REDACTED]`，其余 `***`），**永不泄露原值**。
- **E1 Session 归属算法**：`buildSessions` 纯函数从瞬时进程快照识别 AI 会话——AI 种子（labelForProcess kind=ai/ai-ide）→ ppid 反向邻接 DFS 收集后代（visited 防环 + claimed 去重，首种子优先）。Session identity = `rootPid:createTimeMs`。单快照 MVP。
- **E2 SessionPanel**：新 mosaic 面板「AI 会话」，列出活跃会话 + 聚合资源（进程数/CPU/内存/监听端口）。点击聚焦联动（进程表定位 + 侧栏跟随）；「停止」按钮 `killTree` 整体结束会话。无新轮询器（订阅 processPanelStore）。
- **F1 Run Profiles**：main 进程受控 spawn/stop/restart 开发服务。安全模型：**白名单可执行名**（node/npm/pnpm/yarn/python/git）+ `execFile`（无 shell）+ args 数组，命令注入面最小。profile 持久化（`userData/run-profiles.json`），run 状态经 IPC 事件推送。停止复用 native `killTree`。新 mosaic 面板「Run Profiles」+ 编辑器。
- **F2 Dev Service 健康检测**：`resolveServiceStatus` 纯函数消费 profile 的 `expectedPorts` + 端口雷达连接 → 就绪/启动中/端口冲突/已退出状态徽章。MVP 用端口监听判定（不做 HTTP 健康检测）。

### 新增 — Aurora 视觉重设计

- **token 层（P1）**：明度阶梯中性黑、Linear 三级灰文字、1px hairline、品牌柔紫 + 图表柔青、aurora 环境光 mesh。
- **组件换肤（P2）**：浮层毛玻璃 `backdrop-blur(20px)`；危险按钮"安静危险"风格；徽章降饱和；图表色全走 CSS 变量。
- **Siri 辉光（P3）**：活跃面板边缘流转 aurora 描边（conic-gradient + 16s，`prefers-reduced-motion` 下静止）。
- mosaic 窗口控制按钮改为 CSS 绘制极简图标。

### 修复
- mosaic 白底渗入玻璃面板（库 CSS 写死 `background:white`，玻璃半透明后渗成灰雾）。
- 同名 worktree 共享展开状态 + React key 冲突（A1）。

### 测试
- app 225→308（+83：A1/A2/B/C/D/E1/E2/F1/F2 纯函数与 store TDD）；native 47/47 不变。共 **355 PASS**。

---

## [v2.1] — 2026-07-30

### 新增
- **AI 开发工具默认标签**：进程面板自动识别 AI 工具——Claude Code / Kimi Code / Aider / Codex CLI（kind `ai`，品红紫）与 Cursor（kind `ai-ide`，紫罗兰）。短词规则（如 kimi）带分隔符边界防误伤用户名路径。新增 `defaultRules.test.ts` 11 用例。
- **开机自启开关**：nav 工具栏新增「自启」toggle（`app.setLoginItemSettings`），乐观更新 + 失败回滚。开发模式下作用于 electron.exe（Electron 已知行为），打包后对 CodeMgr.exe 生效。
- **GPU/显存监控**（spec D5）：性能面板新增 GPU 子标签（总使用率 60s 曲线 + 显存条 + per-process Top5）；进程面板新增 GPU% 列（可排序，数据来自 perfStore 轮询）。
  - **采集**：PDH English counters（`PdhAddEnglishCounterW`，`\GPU Engine(*)\Utilization Percentage` + `\GPU Engine(*)\Dedicated Usage`，免本地化）+ DXGI `IDXGIAdapter3::QueryVideoMemoryInfo` 显存总量。实例名宽松解析（只认 `pid_` 前缀，R1 对策）。每 5 周期重展开 PDH 实例集。
  - **降级**：无 GPU 环境（虚拟机/远程桌面）→ `available=false`，UI 显示"不可用"，不报错。
  - **不进 processScan 热路径**：并入 perfCounters（1s 节奏），20ms 红线不动。
  - CMakeLists WIN_LIBS 加 `dxgi`；native 测试 +9（结构断言：available/totalPercent 范围/perProcess 形状）。

### 工程化
- `AGENTS.md` 新增 §10 常见任务食谱：新增 native 函数六处接线 / 新增面板 / 标签规则 / 发版流程 checklist，降低 AI 上手成本。
- 规划文档：GPU 监控 + 进程快照对比 spec（`docs/superpowers/specs/2026-07-30-codemgr-ai-dev-features.md`，决策 D5-D7 锁定）与 v2.1/v2.2 实现计划。

### 测试
- app 197→225（+11 defaultRules AI 标签 +5 AutoLaunch +9 native gpu 结构断言[计入 native] +28 快照 diff/store）；native 38→47（+9 gpu.test.ts）。

---

## [v2.2] — 2026-07-30

### 新增
- **进程快照对比**（spec D6/D7）：一键拍命名快照，任意时刻对比"快照 vs 当前"，三组 diff（新增红/已退出灰/有变化琥珀），新增组支持多选批量结束（复用 killByPids + ConfirmDialog）。命中场景："AI agent 跑一天后清理残留进程"。
  - **存储**：受控文件 IO 通道（`userData/snapshots/<uuid>.json`，照 v1.4 标签规则文件 IO 模式）。4 通道（list/save/delete/load）。路径穿越防护：id 校验 uuid 正则 + save 时 main 用 `crypto.randomUUID()` 生成 id。上限 20 个。
  - **diff 引擎**：`snapshotDiff.ts` 纯函数（TDD 15 用例）。identity = `pid:createTimeMs`（PID 复用防护）；pid 同 createTime 不同 → added+removed（非 unchanged）。
  - **UI**：`SnapshotPanel`（挂 mosaic，第 4 内置面板）。拍快照调 `fetchProcesses` 映射为 SnapshotEntry[]；手动刷新重取当前进程，**不加轮询 interval**（避免第 4 个轮询器）。added/removed 复用 projectGroup 分组折叠。

### 测试
- app 225/225（+15 snapshotDiff + 13 snapshotStore）；native 47/47 不变。

---

## [v2.0] — 2026-07-29

### 新增
- **插件系统（6b 第一步：标签规则注册）**：第三方插件可经 iframe 沙箱注册自定义标签规则。完成 roadmap 方案 6b 的 F2-F4（F1 沙箱选型 + PoC 已于前序完成）。
  - **安全模型**：插件运行在 `iframe sandbox="allow-scripts"`（**无** allow-same-origin），结构上无法访问 Node/Electron/ipcRenderer（F1 PoC ② 实证全 undefined）。唯一能力出口是 `postMessage`。
  - **加载源**：本地 manifest（`userData/plugins.json`，main 读文件系统，渲染层只拿校验过的数据）。逐条 schema 校验，坏条目跳过。
  - **规则接入**：插件规则进独立 `pluginRules` 层（不污染 userRules，不持久化，启动由 PluginHost 重注）。优先级固定末位（内置 > 用户 > 插件）。卸载即清理。
  - **崩溃隔离**：iframe 崩溃不波及主窗口（F1 PoC ④ 验证）+ PluginFrame 加载失败熔断。
  - **文档**：`docs/PLUGINS.md` 插件开发指南 + 可运行示例（`app/poc-plugin-sandbox/examples/`）。
- **插件视图嵌入 mosaic（6b 第二步）**：插件可贡献可视面板嵌入 mosaic 布局，与内置面板（端口/进程/性能）同等地位——拖拽/拆分/关闭。
  - **类型扩展**：`PanelId` 从闭合 3 值联合扩展为 `BuiltInPanelId | \`plugin:${string}\``（模板字面量，保留编译期类型守卫区分内置/插件）。
  - **添加入口**：工具栏「➕」下拉列出 manifest 插件，点击把插件 tile 插入布局。
  - **只读快照推送**：可见 tile 每 2s 推送脱敏快照（进程 pid/name/mem + 端口 port/state/pid/进程名，无 cwd/cmdline）+ 主题 CSS 变量。不可见停推（visibilityStore 节流）。
  - **悬空清理**：插件从 manifest 移除后，启动时自动清理布局树中的悬空 `plugin:*` 叶子（`prunePluginLeaves`），提升存活子树。
  - 视图插件与隐形规则注册 iframe 并存（同一插件 src 可被两种方式加载）。
- **插件数据源管道（6c 第一步：UtilityProcess + MessagePort）**：插件可消费经 UtilityProcess 采集的 native 数据源。本次搭通端到端管道（模拟数据源），验证架构后再接真实 collector。
  - **UtilityProcess**：`utility-host.mjs` 子进程承载 native 采集（进程级隔离，崩溃自动重启，主 app 不依赖）。验证"同一 .node 可在子进程 require"。
  - **MessagePort 多跳链路**：UtilityProcess → main（MessagePort）→ renderer（webContents.send）→ plugin iframe（postMessage）。从零搭建。
  - **白名单机制**：manifest 加 `capabilities`，main `ALLOWED_CAPABILITIES` 校验，未识别项剥离（红线：插件不能自带 .node）。当前白名单含 `demo-source`（模拟数据源）。
  - **协议扩展**：`HostToPluginMsg` 加 `dataSource` 消息；PluginPanel 按 capabilities 订阅并转发。
  - 本次**不含**真实 native collector（demo-source 是固定模拟数据，留 TODO 接真 collector）。
- **插件真实数据源（6c 第二步：磁盘卷列表）**：接入第一个真实 native collector，验证 UtilityProcess → native addon 真实采集链路。
  - **disk_collector**：`GetLogicalDriveStringsW` 枚举卷 → `GetDriveTypeW` 取类型 + `GetDiskFreeSpaceExW` 取空间，返回 `DiskVolume[]`（letter/type/totalBytes/freeBytes/availableBytes）。全在 kernel32，无需改 WIN_LIBS。单卷失败（如未插入 U 盘）空间置 0 不跳过。
  - **白名单**：`ALLOWED_CAPABILITIES` 加 `disk-volumes`；utility-host collect() 路由到 `native.diskVolumes()`。
  - **示例插件**：`disk-volumes-plugin.html` 渲染盘符/类型/空间条。
  - 实测：本机 5 卷（C/D/E/F/G），空间数据真实（如 C: 总 132GB / 可用 9.7GB）。
  - **ABI 重编译**（陷阱 #1）：build:electron 后 UtilityProcess 子进程成功 require 同一 .node 并采集。
- app 165→197（+8 pluginRules + 6 prunePluginLeaves + 3 pluginCapabilities + 新增 defaultRules 等），native 33→38（+5 disk.test.ts）。

---

## [v1.9] — 2026-07-29

### 新增
- **精确 cwd 接入项目分组**：v1.3 的精确 cwd（PEB 直读，按需通道）此前仅用于详情侧栏展示，项目分组仍用启发式 cwd——导致 `npm run dev` 这类命令行无绝对路径的 dev server 误落「未分组」。本次以旁路缓存接入分组键：分组优先用精确值，缺失回退启发式。
  - **触发**：项目视图下展开「未分组」组时，对组内启发式 cwd 为空的进程分批（每批 5 个 + 批间 50ms）按需拉精确 cwd；成功写入 store 缓存，分组重算后这些进程迁到真实项目组。
  - **抖动控制**：旁路缓存（`preciseCwdByPid`）独立于 processScan，一旦填充即冻结，不受刷新影响（直到进程退出随 pidSet 清理）；不覆盖 `ProcessInfo.cwd`（保持单一真相源）。
  - **缓存复用**：详情侧栏「读取精确工作目录」与项目分组共享同一 store 缓存，命中跳过 IPC。
  - 完成 roadmap §272「方案 5 的精确 cwd 接入项目分组」。

### 测试
- app 160→165（+5 groupByProject 精确 cwd：修正空/错误启发式、同值归并、NT 前缀、向后兼容）。

---

## [v1.8] — 2026-07-29

### 新增
- **IPv6 连接枚举**：netScan 新增 `AF_INET6` 的 TCP/UDP 枚举（`GetExtendedTcpTable`/`GetExtendedUdpTable`，`inet_ntop` 格式化），v4/v6 合并返回。绑 `::` 的 dev server（Vite/Node 默认行为）在端口雷达不再不可见。netScan p99 无回归（4.70→4.72ms）。
- **可调刷新间隔**：端口雷达/进程/性能三面板 header 各加间隔选择器（1s/2s/5s/暂停），默认值与 v1.7 一致（3s/2s/1s），随各面板 store 持久化，重启保留。暂停时不建 interval（可见性恢复仍补一次刷新）。
- **进程表虚拟列表**：可见行数 >100 时启用 `@tanstack/react-virtual`（上下等高占位行撑总高，保留 table 布局/sticky 表头/ARIA grid）；≤100 保持全量渲染。与 v1.6 键盘导航共存：焦点行滚动走 `virtualizer.scrollToIndex`，roving tabindex/pid 锚定/Home/End 语义不变。
- **ContextMenu 键盘导航**：↑/↓ 循环移动焦点（跳过禁用项）、Enter/Space 触发、Home/End 跳首末、Esc 关闭；打开时聚焦首个可用项；菜单项 roving tabindex。
- **LabelRuleEditor 焦点陷阱**：Tab/Shift+Tab 在模态内循环不逃逸、Esc 关闭、打开时焦点落首个输入框；补 `role="dialog" aria-modal` 语义。
- **ProcessTable 键盘导航单测**：补齐 v1.6 遗留（此前仅 PortTable 有覆盖）。

### 已知限制
- 虚拟化行高用固定 estimate（29px），不做逐行测量。
- 2000 进程实机滚动流畅度留人工验收；`pnpm dist` 安装包构建留人工（需关第三方杀软实时防护，§9）。
- bench 的 processScan Go/No-Go（p99<20ms）在本机当前负载下未过（p50≈17ms，整机偏慢）；已核实 v1.8 未改 processScan 代码路径（`git diff v1.7..HEAD` 仅 net_collector.cpp），基线二进制同条件复测同样 FAIL，判定为环境性。netScan（p99 7.86ms < 30ms）与 60s 泄漏（RSS -8.18MB）均 PASS。

### 测试
- app 130→160（+8 刷新间隔 store / +4 虚拟化 / +7 ContextMenu 键盘 / +5 焦点陷阱 / +6 进程表键盘），native 32→33（+1 IPv6），共 193 PASS。

---

## [v1.7] — 2026-07-29

### 新增
- **可拖拽多面板布局（react-mosaic）**：用 react-mosaic-component 二叉树布局替换原 Tab 切换。三大面板（端口雷达/进程/性能）可自由拆分、嵌套、拖拽移动、最小化、关闭——把进程当开发工件同时监控多个维度。布局树持久化到 localStorage（`codemgr:layout`），刷新后恢复。
- **3 个布局预设**：经典（进程单面板，等同旧默认）/ 端口+性能（左右 5:5）/ 开发聚焦（进程 70% + 右侧上下分端口与性能）。顶部工具栏一键切换。
- **面板可见性轮询节流**：多面板同时挂载时，被遮挡/折叠/整窗最小化的面板自动停止 native 轮询（IntersectionObserver + visibilitychange），避免三个轮询器（1s/2s/3s）并发造成采集尖刺（roadmap R2 对策）。

### 工程化
- `layoutStore`：mosaic 二叉树持久化 + 预设（persist + partialize，照 processPanelStore 范式）。
- `visibilityStore` + `useVisibilityTracking`：全局可见性广播，三个轮询 hook 改造为可见性感知（不可见即停 interval，可见即恢复并补一次刷新）。
- `Panel` 包装器：面板内容容器 + 可见性追踪接入点（MosaicWindow 提供标题栏/拖拽/控制按钮）。
- 主题适配：mosaic 默认白底/黑分割条覆盖为语义 CSS 变量（`.mosaic-theme` 命名空间），亮/暗主题双适配。

### Fixed
- **native 构建工具链**：`build`/`build:electron`/`rebuild` 不再 baked VS2019 Community 的固定 CMake 路径（该路径在仅有 VS2022 BuildTools 的机器/CI 上不存在，导致 `CMake is not installed` 报错）。改由 `scripts/build.mjs` 用 `vswhere` 动态发现 VS2017+ 自带的 CMake（覆盖所有 edition），并动态读取 Electron 版本号而非硬编码 `43.2.0`。换机器只需装了 VS Build Tools + CMake 组件即可，无需改代码。

### 测试
- app 122→130（+8 layoutStore：3 预设树结构 / setRoot / partialize 形状）。

---

## [v1.6] — 2026-07-29

### 新增
- **进程表键盘导航**：纯导航模型（焦点框与选中态分离）。↑/↓ 移动焦点框（pid 锚定，按可见行序列定位），Enter/Space 切换选中，Home/End 跳首尾。roving tabindex（仅焦点行可 Tab 进入）+ 焦点行自动 scrollIntoView。保留鼠标多选语义。
- **端口表键盘导航**：同纯导航模型（单选）。↑/↓ 移焦点（index 锚定），Enter/Space 选中，Home/End 跳首尾。
- **排序表头键盘触发**：进程表 4 个可排序列（名称/CPU/内存/PID）加 `tabIndex` + `role=button` + Enter/Space 触发排序 + `aria-sort` 状态标注。全选 checkbox 加 `aria-label`。
- ARIA grid 语义：两表加 `role=grid`，行加 `role=row"`，端口表行加 `aria-selected`。

### 工程化
- 焦点态用组件 local state（不进 store，避免轮询干扰），pid/index 锚定防排序/折叠后错位。
- ProcessRow 的 `onRowKeyDown` 用 `useCallback` 稳定化（rows 用 ref 持有），不击穿 `React.memo`。
- `scrollIntoView` 加 `typeof` 防御（jsdom 测试环境无该方法）。

### 已知限制
- 本次仅表格导航。App/PerfPanel 主 tab 方向键、ContextMenu 菜单项方向键、LabelRuleEditor 焦点陷阱留后续。
- ProcessTable 键盘逻辑与 PortTable 同构但未单独单测（需 mock store），核心模式由 PortTable 6 个键盘测试覆盖。

### 测试
- app 116→122（+6 PortTable 键盘导航：ArrowDown/Up/Enter/Space/Home/End/no-wrap）。

---

## [v1.5] — 2026-07-29

### 新增
- **安装包打包**（核心）：新增 electron-builder 配置，`pnpm dist` 产出 NSIS 安装包（`CodeMgr Setup.exe`，带安装向导/快捷方式/卸载）。native addon 经 extraResources 打进 resources/，main.ts 按运行环境（开发/打包）分流定位。已验证成功产出 105MB 安装包。**打包注意**：需 `set CSC_IDENTITY_AUTO_DISCOVERY=false`（跳过 winCodeSign 缓存的 darwin dylib 软链，非管理员账户无建符号链接权限）+ `asar: false`（绕过 electron-builder 25 在本环境的 addWinAsarIntegrity UNKNOWN 写入错误）。
- **错误边界**：全局 `<ErrorBoundary>` 包裹 App，子组件渲染抛错不再白屏——显示降级 UI（错误信息 + 重试 + 刷新页面）。支持自定义 fallback。
- **窗口状态持久化**：窗口位置/大小/最大化状态跨重启保留。读取时校验 bounds 是否落在可见显示器内（防换屏/断屏后窗口跑屏外），写盘防抖 500ms。
- **版本号显示**：导航栏右侧显示当前版本（`v{version}`，来自 `app.getVersion()`）。

### 工程化
- **bench 接入 CI**：CI 增加 Performance bench 步骤（continue-on-error 软 gate）。GitHub Actions runner 负载波动大，硬 gate 会误杀合法 PR；软报告让性能回归可见但不 block。
- **native 测试补全**：新增 cpuDelta/perfCounters 正确性测试（cpuDelta 双快照机制 + PerfData 结构校验）。
- **顺带修复**：postcss 版本笔误（10.5.4→8.5.24，10.x 不存在）；托盘图标缺失时降级为空图标防崩。

### 已知限制
- 窗口状态持久化依赖 electron 运行时（screen/app），无法单测，留人工验收。
- 打包需本机关闭第三方杀软（或给项目目录加排除）+ 上述 CSC 环境变量。
- 安装包未签名（个人项目无证书），Windows 首次运行会提示 SmartScreen 警告。

### 测试
- app 110→116（+6 ErrorBoundary），native 24→32（+8 cpu），共 148 PASS。

---

## [v1.4] — 2026-07-29

### 新增
- **标签规则导入导出**：标签规则编辑器新增「导出」「导入」按钮。导出把当前规则集（自定义规则 + 默认开关/覆盖）存为 JSON 文件；导入从文件加载并**整体替换**现有规则（导入前对有改动的规则二次确认）。文件路径由主进程对话框决定，渲染层只收发数据、拿不到路径（守安全红线）。新增 `IPC.EXPORT_LABEL_RULES` / `IPC.IMPORT_LABEL_RULES` 两个受控文件 IO 通道。
- **进程行右键菜单**：进程表（树形视图）与项目分组视图的进程行支持右键，菜单含「结束进程 / 结束进程树 / 复制命令行 / 复制 PID」。结束操作复用现有确认对话框流程；复制操作失败静默（clipboard 可能被环境阻断）。自建轻量 `ContextMenu` 组件（零依赖，视口边界翻转定位，Esc/外部点击关闭）。
- **详情侧栏可拖宽**：进程详情侧栏宽度从固定 320px 改为可拖拽（allotment 分栏）。拖动比例钳制在 15%-60%（太窄曲线看不清、太宽挤掉进程表），随 `codemgr:process-panel` 持久化，刷新恢复。仅 lg+ 屏（≥1024px）显示侧栏，小屏仍只显示进程表。分割条用项目主题色适配亮/暗。

### 工程化
- v1.4 为 v2.0 插件系统预演了「受控文件 IO 通道」模式（main 封装 dialog+fs，渲染层只拿数据）。
- 测试基线：121 → 134 PASS（app 97→110，native 24 不变）。新增 labelRulesStore 导入语义、ContextMenu 组件、setSidebarProportion 钳制单测。

### 已知限制
- 标签规则的 main handler（`validateLabelRulesPayload` + dialog/fs）未单测——耦合 electron 环境，导入导出留人工验收；可测逻辑（store 的 `replaceAll` 深拷贝/替换语义）已覆盖。
- 右键菜单的剪贴板复制在 contextIsolation 下依赖 navigator.clipboard，部分环境可能阻断（与侧栏 copyCmd 同条件）。

---

## [v1.3] — 2026-07-29

### 新增
- **自定义标签规则（核心）**：进程标签从硬编码 if 链改为数据驱动引擎。新增「⚙️ 标签规则」编辑器（导航栏），支持启用/禁用默认规则、增删自定义规则、实时预览命中结果。规则模型用条件组（include 全部命中=AND / exclude 命中=NOT / 多组=OR），1:1 覆盖原规则的混合条件；偏好随 localStorage 持久化（codemgr:labelRules）。`labelForProcess(name, cmdline)` 签名不变，调用点零改。
- **单进程 CPU/内存曲线**：进程详情侧栏新增所选进程的 CPU%（0–100）与内存两条迷你曲线（60 点 ≈ 120s 滚动窗口）。数据复用现有轮询（cpuDelta + processScan 的 workingSetBytes），同一 tick 配对采点，无需新 IPC。进程退出后历史自动清理。
- **按需精确工作目录（路线 A）**：详情侧栏「读取精确工作目录」按钮按需直读 PEB `CurrentDirectory.DosPath`（精确值，区别于 ProcessInfo.cwd 的命令行启发式）。按钮复刻环境变量的 idle/loading/error/done + pidRef 防陈旧模式；精确值存组件 local state，不覆盖启发式 cwd（项目分组仍以其为键）。

### 采集层（codemgr-native）
- `readProcessCwd(pid)`：PEB 行走（与 `readProcessEnv` 同源骨架），读 `RTL_USER_PROCESS_PARAMETERS` 偏移 0x38 的 UNICODE_STRING，剥离 `\??\` / `\\?\` NT 前缀。**不进 `processScan` 热路径**（直读 PEB cwd 每进程多 1 NtQIP + 2 ReadProcessMemory，全量采集会破 20ms 红线）。

### 修复（kill 路径加固 + 轮询竞态）
- **单进程 kill 漏保护名单**：`killProcess(pid)` 原先绕过 `IsProtected()`，现已与 `killByPids`/`killByName`/`killTree` 对齐，拒绝终止保护进程（System/svchost/electron 等）与自身。
- **kill 连点重复触发**：端口雷达/进程面板的五条 kill 流程（单杀/批量/全 node/组杀/杀树）统一加 `killBusy` 进行中态，禁用 ConfirmDialog 按钮，避免重复 `TerminateProcess`。
- **kill 失败静默/误判**：所有 kill 流程加 try/catch + 用户可见提示，区分「受保护进程 / 权限不足 / 已退出」三种失败；批量/组杀按 killed/总数 比例提示。
- **ConfirmDialog 无障碍**：`role=alertdialog` + aria 标签、Esc 关闭、打开时聚焦取消按钮（降低误触结束）。
- **首载 loading 卡死**：三个轮询 hook（usePerf/usePortRadar/useProcessPanel）的 `finally` 检查 `firstRef.current`，但成功路径已将其置 false，导致 `setLoading(false)` 永不执行——头部常驻「刷新中…」。改用 `isFirst` 快照修复。

### 性能
- processScan p99 = 12.38 ms（396 进程，按需 cwd 通道零影响，红线 < 20ms 通过）。
- netScan p99 = 6.20 ms（465 连接）。
- 60s 内存泄漏检测 RSS −8.49 MB（无泄漏）。

### 测试覆盖
- labelRules 引擎单测（include/exclude/groups/field/顺序）、processPanelStore 历史采点与裁剪、projectGroup NT 前缀剥离、readProcessCwd 正确性（自身进程/System 进程）、killProcess 守卫（保护 pid / pid 0 拒绝）。共 121 PASS（native 24 + app 97）。

---

## [v1.2] — 2026-07-29

### 新增
- 端口雷达：搜索过滤（端口/进程名/PID/地址）
- 端口雷达：端口冲突高亮（同协议同端口被多进程监听时 ⚠ 标红）
- 进程：结束进程树（killTree），表格行与详情侧栏均可触发
- 进程详情侧栏：按需查看进程环境变量

### 修复
- codemgr-native/index.ts 补齐 perfCounters 类型声明
- cwd 字段注释与实际实现（命令行启发式抽取）对齐
- README clone 地址修正为当前仓库

---

## [v1.1] — 2026-07-29

### 新增
- **按项目分组视图（核心差异化）**：进程面板新增「树形 / 按项目」视图切换。按项目视图读取每个进程的工作目录，把同目录下的进程归为一组（组名取目录最后一段），可展开查看组内进程，并一键「结束本组」（复用 `killByPids`）。无法识别工作目录的进程归到「未分组」。视图偏好随排序/过滤一并持久化。
- **进程详情侧栏**：进程面板选中单个进程时，右侧（lg+ 宽屏）展示详情——命令行（可滚动 + 一键复制）、工作目录、父进程 PID、运行时长、累计 CPU 时间（kernel+user）、内存、线程数、句柄数。未选 / 多选 / 进程已退出时显示对应提示。
- **保护名单**：native 层新增保护名单（System/Registry/smss/csrss/wininit/winlogon/services/lsass/svchost/CodeMgr/electron），`killByPids` 与 `killByName` 均拒绝终止保护进程，且永不终止自身。
- **一键结束所有 node.exe**：进程面板新增预设按钮（仅当快照中存在 node.exe 时显示），通过 `killByName` 全量清理，仍受保护名单约束。
- **采集层接口**：新增 `killByPids(pids: number[]): number`；`ProcessInfo` 新增 `cwd` 字段。
- **磁盘 IO 速率**：性能面板的磁盘子标签从「仅空间」升级为「空间 + 读/写速率 + 活动时间%」（PDH 计数器 `\LogicalDisk(*)\*`）。
- **统一加载/错误/空状态**（LoadState 组件）：三个面板首屏骨架加载、出错提示 + 自动重试、空数据占位，体验一致。
- **轮询健壮性**：三个 hook 加 in-flight 防重入守卫；加载态仅首载闪烁；单次刷新失败降级为可关闭的顶部 banner（保留已有数据，不再整屏替换）。
- **亮色主题**：语义化颜色变量（`fg.primary/secondary/muted` + `bg-*`），亮/暗两套完整适配，53 处硬编码 `text-slate-*` 替换为自适应变量。
- **状态持久化**：主题、排序、过滤、视图模式重启后保留（Zustand persist）。

### 修复
- **托盘退出**：托盘「退出」菜单真正退出应用（`isQuitting` 标志修复 close 拦截），全局快捷键正确注销；native 加载失败时弹出错误对话框而非无提示闪退。
- **端口雷达 processName**：`netScan()` 现填充真实进程名（93% 连接可解析），端口雷达表格不再显示「—」。
- **命令行读取 bug**：改用官方 `ProcessCommandLineInformation`（class 60）替代 PEB 偏移试探——原实现误取 ImagePathName（96% 进程只有 exe 路径无参数），导致 vite/npm/jest 等参数标签全部失效。修复后带参数命令行正确获取。
- **批量 kill 误伤**：批量结束改为按显式 PID 列表精确终止选中的进程，不再 `killByName` 误杀全系统同名进程。
- **全选无视过滤**：`selectAll` 接受 PID 列表参数，表头全选只选中当前过滤后的进程。
- **死 PID 残留**：`setProcesses` 自动修剪失效的 `selectedPids` 与 `cpuMap`。
- **排序方向**：表头排序点击同一列可切换升/降序（`toggleSort` 不再是死代码）。
- **kill 静默失败**：单击结束失败时弹窗提示（原先静默）。

### 优化
- **进程列表渲染性能**：ProcessRow 抽为 `React.memo` + 稳定 callback，预计算 childrenParentSet（O(n) 替代每行 O(n²)）。
- **采集层**：cwd 改为从命令行启发式抽取（放弃直读 PEB CurrentDirectory，后者每进程多 1 次 NtQIP + 3 次 NtRVM，实测把 p99 推到 ~21ms 超标；启发式抽取 p99=17.7ms 通过）。局限见 `process_collector.cpp` 注释。
- **测试覆盖**：LoadState/ConfirmDialog/PortTable/batchKill/projectGroup/format 组件与纯函数测试，共 78 PASS（native 11 + app 67）。

---

## [v1.0] — 2026-07-29

### 新增
- **端口雷达**（首屏差异化）：监听端口列表 + dev/db 端口标签 + 一键 kill + 3 秒自动刷新。
- **进程面板**：树形进程视图（父子关系展开/折叠）+ 命令行智能标注（dev server/test/build/docker/db）+ CPU%/内存排序 + 搜索过滤 + 多选批量 kill + 高内存/CPU 红黄警告。
- **性能面板**：CPU（总览 60s 实时曲线 + 各核心进度条）、内存（使用率曲线）、磁盘（每盘空间条，>70% 琥珀/>90% 红色）、网络（活跃网卡实时收发速率）。
- **系统**：托盘常驻（最小化/关闭隐藏到托盘，右键菜单显示/隐藏/退出）+ 全局快捷键 `Ctrl+Shift+M` 唤出 + 暗色/亮色主题切换。

### 采集层（codemgr-native）
- `processScan()`：NtQuerySystemInformation 全量进程，含 PEB 命令行读取。
- `netScan()`：GetExtendedTcpTable/UdpTable 网络连接。
- `cpuDelta()`：双快照 CPU% 差值。
- `perfCounters()`：系统级 CPU/内存/磁盘/网络指标。
- `killProcess(pid)` / `killByName(name)`：进程终止。

### 性能
- processScan p99 = 10.16 ms（真实 2 秒轮询，327 进程）。
- netScan p99 = 2.53 ms（233 连接）。
- 60 秒高频采集 RSS 增长 −6.21 MB（无泄漏）。

### 工程化
- Conventional Commits 提交规范。
- pre-commit hook（增量 typecheck + test）。
- GitHub Actions CI（typecheck + test + build）。
- AGENTS.md（AI 协作指引）、CONTRIBUTING.md、issue/PR 模板。

---

## [v0.1-collector] — 2026-07-29

### 采集层验证（Go/No-Go 全过）
- C++ Node-API addon 骨架 + cmake-js 构建（为 Electron 重编译）。
- `processScan()` via NtQuerySystemInformation。
- `netScan()` via GetExtendedTcpTable/UdpTable。
- `cpuDelta()` 双快照。
- `killProcess` / `killByName`。
- 三项 Go/No-Go 判据全部通过（性能基准 + 内存泄漏检测）。
