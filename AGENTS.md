# CodeMgr — AI 协作指引

> **每次会话开始，先读本文件。** 它是 AI 在本仓库工作的唯一入口，指向所有规范与背景。

---

## 1. 项目定位

**CodeMgr** 是一款面向 Windows 开发者的工作流管理器。它不追求替代 System Informer，而是补齐后者在"开发工件视角"上的空白：端口被哪个 dev server 占了、哪些进程属于同一个项目、怎么一键清掉所有 node.exe。

- **差异化定位**：System Informer 把进程当"系统资源"管理；CodeMgr 把进程当"开发工件"管理。
- **不做的事**：内核级调试、内存编辑、反恶意软件——这些 SI 已做到极致，不与之竞争。
- **完整设计背景**：`docs/superpowers/specs/2026-07-29-codemgr-design.md`

---

## 2. 技术栈

| 层 | 技术 | 位置 |
|----|------|------|
| 采集层 | C++17 + Node-API (node-addon-api)，直读 Win32/内核 API | `codemgr-native/` |
| 构建（native） | cmake-js，为 Electron 重编译 | `codemgr-native/CMakeLists.txt` |
| 主进程 | Electron 43.2.0 (Node 24) | `app/electron/` |
| 渲染层 | React 18 + TypeScript + Tailwind + Zustand + Recharts | `app/src/` |
| 渲染构建 | Vite 5 + vite-plugin-electron | `app/vite.config.ts` |
| 包管理 | pnpm workspace（monorepo） | 根 `pnpm-workspace.yaml` |
| 测试 | Vitest（TS 层）| `app/tests/`、`codemgr-native/tests/` |

---

## 3. 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Renderer                          │
│              (React 18 + TS + Tailwind + Zustand)            │
│                                                              │
│   App.tsx ── Tab 导航 ──┬─ PortRadar    (端口雷达, 首屏)      │
│                         ├─ ProcessPanel (进程, 树形+标注)     │
│                         └─ PerfPanel     (性能, 实时图表)     │
│                                                              │
│   数据流: hooks(轮询) → store(Zustand) → components(渲染)     │
├──────────────────── contextBridge (安全边界) ────────────────┤
│  preload.ts 暴露 window.codemgr.* (封装后 API, 不暴露 ipcRenderer) │
├──────────────────────────────────────────────────────────────┤
│                    Electron Main                             │
│   main.ts: 窗口 + 托盘 + 全局快捷键 + ipcMain.handle          │
│   ipc-types.ts: IPC 通道名常量 + 载荷类型 (main/preload/renderer 共享) │
├──────────────────── require() ───────────────────────────────┤
│              codemgr-native (C++ Node-API addon)             │
│   processScan()  → NtQuerySystemInformation + PEB 命令行读取  │
│   netScan()      → GetExtendedTcpTable/UdpTable              │
│   cpuDelta()     → 双快照时间差值                            │
│   perfCounters() → GlobalMemoryStatusEx + NtQuery(class 8)   │
│   killProcess/killByName → OpenProcess + TerminateProcess    │
└──────────────────────────────────────────────────────────────┘
```

**关键边界（红线）：**
- 渲染进程（`app/src/*`）**绝不**直接 `require('codemgr-native')`——只能通过 `app/src/lib/ipc.ts`（即 preload 暴露的 `window.codemgr.*`）。
- 主进程/preload（`app/electron/*`）**绝不** import 渲染层。
- 采集层（`codemgr-native/src/*`）每个 `*_collector.cpp` 只负责一种数据源，互不依赖。

---

## 4. 快速命令

| 用途 | 命令 |
|------|------|
| 启动开发（热重载） | `pnpm dev` |
| 生产模式启动 | `pnpm start` |
| 全量构建（native+渲染） | `pnpm build` |
| 打包成安装包（NSIS exe） | `pnpm dist` |
| 仅构建渲染层 | `pnpm build:app` |
| 跑渲染层测试 | `cd app && pnpm vitest run` |
| 跑 native 测试 | `pnpm test:native` |
| 跑全部测试 | `pnpm test:native && cd app && pnpm vitest run` |
| 性能基准（Go/No-Go） | `pnpm bench` |
| 类型检查（渲染层） | `cd app && pnpm typecheck` |
| 为 Electron 重编译 native | `cd codemgr-native && pnpm build:electron` |

---

## 5. 必须遵守的规范

### 提交规范（Conventional Commits）
```
<type>(<scope>): <subject>

type:   feat | fix | build | chore | docs | refactor | test | perf
scope:  native | app | ci | docs（可选）
```
示例：`feat(app): add process panel tree view`、`fix(native): cmdline PEB offset`。

### 分支规范
- `main`：永远可发布、测试通过。**禁止直接 push**，走 PR。
- `feat/<scope>`：新功能（如 `feat/perf-panel`）
- `fix/<scope>`：bug 修复
- `chore/<scope>`：工程化/依赖/重构（不面向用户）

### 测试规范
- 新代码必须有测试。纯逻辑（store/labels）用 TDD，UI 用人工验收。
- pre-commit hook 会**增量**跑相关测试（改 app/ 只跑 app 测试，改 native/src/ 只跑 native 测试）。
- 性能敏感改动（native 采集层）必须跑 `pnpm bench` 确认无回归。

### 安全规范
- 见架构图"关键边界"。渲染层直接 require native = **必须拒绝的 PR**。

### 文档规范
- 每个面向用户的改动更新 `CHANGELOG.md`。
- 重大架构决策记录到 `docs/superpowers/specs/`，实现计划到 `docs/superpowers/plans/`。

---

## 6. 文件导航

| 想找什么 | 去哪 |
|---------|------|
| AI 协作规范（本文件） | `AGENTS.md` |
| 人工贡献指南 | `docs/CONTRIBUTING.md` |
| 架构详解 | `docs/architecture.md` |
| 设计决策（spec） | `docs/superpowers/specs/` |
| 实现计划（plan） | `docs/superpowers/plans/` |
| 变更记录 | `CHANGELOG.md` |
| 插件开发指南 | `docs/PLUGINS.md` |
| IPC 通道与类型 | `app/electron/ipc-types.ts` |
| native 导出接口 | `codemgr-native/index.ts` |

---

## 7. 常见陷阱（给 AI 的避坑指南）

1. **ABI 重编译**：改了 `codemgr-native/` 任何 C++ 后，必须 `pnpm build:electron`（不是 `pnpm build`，那个是 Node 目标）。否则 Electron 里 `require()` 崩溃。
2. **cmake-js 找不到 CMake**：本机 CMake 在 VS 组件里不在 PATH。`build`/`build:electron`/`rebuild` 脚本走 `scripts/build.mjs`，用 `vswhere` 动态发现 VS2017+ 自带的 CMake（含 BuildTools/Community/Enterprise 所有 edition），不再 baked 固定路径。换机器只需装了 VS Build Tools + CMake 组件即可，无需改代码。
3. **winternl.h 冲突**：native 采集层用自定义 `MY_SYSTEM_PROCESS_INFORMATION` 避免与 winternl 重复定义。新加 NT 结构时遵循同样模式。
4. **SystemProcessorPerformanceInformation (class 8)**：缓冲区必须**精确**等于 `核数×48` 字节，否则静默返回空。
5. **winsock 冲突**：net_collector.cpp 必须先 `#define WIN32_LEAN_AND_MEAN` 再 include winsock2/ws2tcpip/iphlpapi，否则与 windows.h 的旧 winsock 冲突。
6. **设计文档曾在外部目录**：历史原因 spec/plan 曾在 `ZCodeProject/docs/`，现已迁入仓库 `docs/superpowers/`。引用时用仓库内路径。
7. **用 electron 跑临时脚本验证 native**：`npx electron script.js` 会启动 app 的 GUI 主入口而非执行脚本。要跑独立脚本验证 native addon，用 `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron script.js`，或在脚本里 `app.whenReady().then(()=>{...})` 后退出。
8. **PDH 类型名**：Windows SDK 的 `pdh.h` 用 `PDH_HQUERY`（查询句柄）和 `PDH_HCOUNTER`（计数器句柄），没有 `PDH_HQ`/`PDH_HC` 这种简写。
9. **命令行读取**：用 `NtQueryInformationProcess(ProcessCommandLineInformation = 60)`，**不要**手读 PEB 偏移——后者会误取 ImagePathName（只有 exe 路径无参数）。
10. **cwd 两套机制**：`processScan` 热路径仍用命令行启发式抽取 cwd（零额外系统调用，p99=12.38ms，过 20ms 红线）。精确 cwd 走**按需通道** `readProcessCwd(pid)`（PEB `CurrentDirectory.DosPath` 直读，偏移 0x38），**不进每轮采集**——直读每进程多 1 NtQIP + 2 ReadProcessMemory，全量采集会破红线。详情侧栏「读取精确工作目录」按钮触发，结果存组件 local state，不覆盖 `ProcessInfo.cwd`（项目分组以其为键）。新增需要精确 cwd 的功能务必走按需通道，勿塞进 processScan。
11. **kill 保护名单**：`killByPids`/`killByName` 内置保护名单（System/svchost/electron 等），新增 kill 路径必须复用 `IsProtected()` 检查。

---

## 8. 当前版本状态

- **v2.3**（未发版）：Aurora UI 视觉重设计（spec `docs/superpowers/specs/2026-07-30-codemgr-aurora-ui.md` v1.2 "Linear 纪律 × Apple 毛玻璃"：明度阶梯中性黑 + 玻璃浮层 + 安静危险按钮 + Siri 辉光聚焦描边 + mosaic 白底渗入修复 + 控制按钮 CSS 图标）。
- **v2.2**（tag `v2.2`）：进程快照对比（受控文件 IO `userData/snapshots/` + diff 引擎 identity=pid:createTimeMs + SnapshotPanel 挂 mosaic，完成 spec D6/D7）。
- **v2.1**（tag `v2.1`）：AI 开发工具默认标签（Claude/Kimi/Aider/Codex/Cursor/Ollama/LM Studio，新 kind `ai`/`ai-ide`）+ 开机自启开关（setLoginItemSettings，nav toggle）+ GPU/显存监控（PDH English GPU Engine counters + DXGI 显存 + perf GPU 子标签 + 进程 GPU% 列，完成 spec D5，无 GPU 降级；GPU 采集经预热 + 三层优化）。
- **v2.0**（tag `v2.0`）：插件系统 6b 第一步——iframe 沙箱插件注册标签规则（`userData/plugins.json` manifest，postMessage 受控 API，pluginRules 独立层末位优先级，崩溃隔离）；6b 第二步——插件视图嵌入 mosaic（PanelId 模板字面量扩展、添加面板入口、只读快照推送、悬空叶子清理）；6c 第一步——插件数据源管道（UtilityProcess + MessagePort 多跳链路 + 白名单机制，模拟数据源验证架构）；6c 第二步——真实 native 数据源（disk-volumes：磁盘卷列表 collector，验证 UtilityProcess → native 真实采集链路）。F1 沙箱选型 + PoC 已实证锁定。完成 roadmap 方案 6b 全部 + 6c 管道与首个真实数据源。
- **v1.9**（tag `v1.9`）：精确 cwd 接入项目分组（旁路缓存 `preciseCwdByPid`，展开未分组组时按需拉取修正 dev server 误归组；缓存冻结防抖动；侧栏复用缓存）。完成 roadmap 方案 5 余项。
- **v1.8**（tag `v1.8`）：IPv6 连接枚举（端口雷达不再漏绑 `::` 的 dev server）+ 三面板可调刷新间隔（1s/2s/5s/暂停，持久化）+ 进程表虚拟列表（>100 行启用，与键盘导航共存）+ ContextMenu 键盘导航 + LabelRuleEditor 焦点陷阱。
- **v1.7**（tag `v1.7`）：react-mosaic 多面板自由布局（替换 Tab，三大面板可拆分/嵌套/拖拽/关闭，二叉树持久化）+ 3 布局预设 + 面板可见性轮询节流（IntersectionObserver + visibilitychange，对策 roadmap R2）+ native 构建工具链修复（vswhere 动态发现 CMake）。
- **v1.6**（tag `v1.6`）：进程表 + 端口表键盘导航（纯导航模型，↑↓ 移焦点框/Enter 选中/Home-End 跳首尾/roving tabindex）+ 排序表头键盘触发 + ARIA grid 语义。
- **v1.5**（tag `v1.5`）：安装包打包（electron-builder NSIS）+ 全局 ErrorBoundary（防白屏）+ 窗口状态持久化 + 版本号显示 + bench 接入 CI + native cpuDelta/perfCounters 测试补全。
- **v1.4**（tag `v1.4`）：标签规则导入导出（受控文件 IO 通道）+ 进程行右键菜单（ContextMenu 组件）+ 详情侧栏可拖宽（allotment 分栏，比例持久化）。
- **v1.3**（tag `v1.3`）：自定义标签规则（数据驱动引擎 + 编辑器 + localStorage 持久化）+ 单进程 CPU/内存曲线 + 按需精确工作目录（PEB 直读，路线 A，不进热路径）+ kill 路径加固（killProcess 补保护名单）。
- **v1.2**（tag `v1.2`）：端口雷达搜索过滤 + 冲突高亮 + 结束进程树 + 进程环境变量查看。
- **v1.1**（tag `v1.1`）：断链修复 + 高危交互治理 + 按项目分组 + 进程详情侧栏 + 亮色主题 + 持久化。
- **v1.0**（tag `v1.0`）：四大板块完成（端口雷达/进程/性能/系统）。
- 性能基线：processScan p99=12.38ms（真实 2s 轮询，396 进程，v1.5 未改 native 采集层）、netScan p99<30ms 判据 PASS（v1.8 IPv6 合并枚举后实测 4.7~7.9ms，随负载波动）、60s 无泄漏。注意：bench 对机器负载敏感（软 gate），processScan 的 20ms 判据在高负载机器上会环境性 FAIL，判读时先做基线对照。
- 测试：app 256/256 + native 47/47，共 303 PASS。
- 后续规划见 `docs/CONTRIBUTING.md` 的 roadmap 节。

## 9. 打包与 CI 注意事项（v1.5 新增）

12. **打包命令**：`pnpm dist`（一键 build + electron-builder）。产物在 `release/`。
13. **打包环境坑**（本机实测）：
    - 需 `set CSC_IDENTITY_AUTO_DISCOVERY=false`（已写进 app/package.json 的 dist 脚本），跳过 winCodeSign 缓存解压——该缓存含 macOS darwin dylib 软链，非管理员账户无建符号链接权限会失败。
    - 需 `asar: false`（已写进 electron-builder.yml）——绕过 electron-builder 25 在本环境的 `addWinAsarIntegrity` UNKNOWN 写入错误。
    - 需关闭第三方杀软实时防护——否则打包过程中 exe 被锁。
14. **native addon 路径**：main.ts 用 `app.isPackaged` 分流——开发 `../../codemgr-native/build/Release/...`，打包 `process.resourcesPath/codemgr-native.node`（extraResources 带入）。改 native 后打包前必须 `pnpm build:electron`（Electron ABI）。
15. **图标资产**：`app/build/icon.ico`（多尺寸 256/128/64/48/32/16，electron-builder 按约定自动采用）、`icon.png`（256）、`tray-icon.png`（32，透明底）。由 `app/build/gen_icon.py` 生成（`py app/build/gen_icon.py`，依赖 Pillow），改设计改脚本重跑即可，勿手改位图。
16. **CI bench**：continue-on-error 软 gate（runner 负载波动大，硬 gate 会误杀）。

---

## 10. 常见任务食谱（AI 上手捷径）

高频任务的"要碰哪些文件"清单，省去每次重新摸索链路。改完一律遵守 §5（测试/提交规范）与 §7（避坑）。

### 10.1 新增一个 native 函数（6 处接线，缺一不可）

| # | 文件 | 改什么 |
|---|------|--------|
| 1 | `codemgr-native/src/<collector>.cpp/.h` | 实现（单 collector 单职责） |
| 2 | `codemgr-native/src/addon.cpp` | `exports.Set("fnName", ...)` 注册 |
| 3 | `codemgr-native/index.ts` | `NativeBindings` 加类型声明 |
| 4 | `app/electron/ipc-types.ts` | `IPC` 通道常量 + `ExposedApi` 方法签名 |
| 5 | `app/electron/preload.ts` + `app/electron/main.ts` | invoke 封装 + ipcMain.handle（catch 后返回降级值） |
| 6 | `app/src/lib/ipc.ts` | 渲染层薄封装 |

- 测试：native 侧 `codemgr-native/tests/` 加用例（读自身进程必有数据）。
- **必跑**：`pnpm build`（Node 目标，供测试）→ `pnpm vitest run` → `pnpm build:electron`（Electron ABI）→ 动了热路径再 `pnpm bench`。

### 10.2 新增一个面板

1. `app/src/store/<panel>Store.ts`（persist + partialize 白名单，照 portRadarStore 范式，TDD）。
2. `app/src/hooks/use<Panel>.ts`（轮询：busyRef 防重入 + stoppedRef 卸载清理 + visibilityStore 可见性订阅 + 从 store 读 pollMs）。
3. `app/src/components/<Panel>.tsx`（渲染，不直接调 IPC，走 `lib/ipc.ts`）。
4. 挂进 mosaic：`App.tsx` 的 PANELS 映射 + `layoutStore` 预设（如需）。
5. 加载/错误/空三态用 `LoadState` 组件（错误在有数据时降级为 banner，不整屏替换）。

### 10.3 新增/修改标签规则

- 只改 `app/src/lib/defaultRules.ts`（默认规则，TDD：`app/tests/defaultRules.test.ts`）。
- 规则模型：`groups`（OR）× 组内 `include`（AND 子串）+ `exclude`（NOT）；`field: name/cmdline/both`。**无正则**。
- 防误伤：短词（如 kimi）必须带分隔符/扩展名（`kimi.exe`、`\kimi\`），用户名目录是经典误伤面。
- 新 kind 要补 `KIND_COLORS`（目前在 `ProcessTable.tsx`/`ProjectGroupView.tsx`/`LabelRuleEditor.tsx` 三处重复定义——改动要同步三处）。

### 10.4 发版流程

1. 全量回归：`pnpm test:native && cd app && pnpm vitest run && pnpm typecheck`。
2. 性能敏感改动：`pnpm bench`（注意负载敏感，先做基线对照，§8 有判读说明）。
3. 更新 `CHANGELOG.md`（新版本节）+ `AGENTS.md` §8（版本/测试数/基线）。
4. `pnpm build` 验证 → 打 tag（如 `v1.9`）→ `pnpm dist` 留人工（需关杀软）。
