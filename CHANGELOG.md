# Changelog

本文件记录 CodeMgr 所有面向用户的变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
