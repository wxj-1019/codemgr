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
| IPC 通道与类型 | `app/electron/ipc-types.ts` |
| native 导出接口 | `codemgr-native/index.ts` |

---

## 7. 常见陷阱（给 AI 的避坑指南）

1. **ABI 重编译**：改了 `codemgr-native/` 任何 C++ 后，必须 `pnpm build:electron`（不是 `pnpm build`，那个是 Node 目标）。否则 Electron 里 `require()` 崩溃。
2. **cmake-js 找不到 CMake**：本机 CMake 在 VS 组件里不在 PATH，build 脚本已 baked `--cmake-path`。换机器需调整。
3. **winternl.h 冲突**：native 采集层用自定义 `MY_SYSTEM_PROCESS_INFORMATION` 避免与 winternl 重复定义。新加 NT 结构时遵循同样模式。
4. **SystemProcessorPerformanceInformation (class 8)**：缓冲区必须**精确**等于 `核数×48` 字节，否则静默返回空。
5. **winsock 冲突**：net_collector.cpp 必须先 `#define WIN32_LEAN_AND_MEAN` 再 include winsock2/ws2tcpip/iphlpapi，否则与 windows.h 的旧 winsock 冲突。
6. **设计文档曾在外部目录**：历史原因 spec/plan 曾在 `ZCodeProject/docs/`，现已迁入仓库 `docs/superpowers/`。引用时用仓库内路径。

---

## 8. 当前版本状态

- **v1.0**（tag `v1.0`）：四大板块完成（端口雷达/进程/性能/系统）。
- 性能基线：processScan p99=10ms（真实 2s 轮询）、netScan p99=3ms、60s 无泄漏。
- 测试：app 21/21 + native 7/7，共 28 PASS。
- 后续规划见 `docs/CONTRIBUTING.md` 的 roadmap 节。
