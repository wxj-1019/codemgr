# Changelog

本文件记录 CodeMgr 所有面向用户的变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
