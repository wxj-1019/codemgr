# 架构详解

本文件补充 `AGENTS.md` 第 3 节的架构图，提供更深的实现细节。设计决策背景见 `docs/superpowers/specs/2026-07-29-codemgr-design.md`。

---

## 三层架构

```
┌─ 渲染层 (Renderer) ──────────────────────────────────────────┐
│  app/src/*  ·  React 18 + TS + Tailwind + Zustand + Recharts │
│                                                              │
│  App.tsx (react-mosaic 多面板布局 + 主题切换)               │
│    ├─ PortRadar     → usePortRadar  → portRadarStore         │
│    ├─ ProcessPanel  → useProcessPanel → processPanelStore    │
│    └─ PerfPanel     → usePerf       → perfStore              │
│                                                              │
│  面板可拆分/嵌套/拖拽（layoutStore 持久化二叉树）；          │
│  被遮挡面板自动停轮询（visibilityStore + IntersectionObserver）│
│  每个面板 = hook(轮询) + store(状态) + components(渲染)       │
│  单向数据流：IPC → hook → store → component                   │
├─ contextBridge (安全边界) ───────────────────────────────────┤
│  app/electron/preload.ts                                     │
│    暴露 window.codemgr.{                                     │
│      fetchConnections, fetchProcesses, fetchCpu, fetchPerf,  │
│      killProcess, killByPids, killByName, killTree,          │
│      fetchProcessEnv, fetchCwd,                              │
│      exportLabelRules, importLabelRules, getAppVersion }     │
│    （封装 ipcRenderer.invoke，绝不暴露 ipcRenderer 本身）      │
├─ 主进程 (Main) ──────────────────────────────────────────────┤
│  app/electron/main.ts                                        │
│    · BrowserWindow (contextIsolation=true, nodeIntegration=false) │
│    · Tray (最小化到托盘) + globalShortcut (Ctrl+Shift+M)      │
│    · ipcMain.handle → 调用 native 函数                       │
│  app/electron/ipc-types.ts                                   │
│    · IPC 通道名常量（main/preload/renderer 共享，避免拼写不一致）│
│    · 载荷类型（NetConnection / ProcessInfo / CpuUsage / PerfData）│
├─ require() ──────────────────────────────────────────────────┤
│  codemgr-native/build/Release/codemgr-native.node            │
│    （为 Electron 43.2.0 重编译，ABI 匹配）                    │
├─ 采集层 (C++ Node-API addon) ────────────────────────────────┤
│  codemgr-native/src/*  ·  C++17 + node-addon-api             │
│                                                              │
│  process_collector  NtQuerySystemInformation(class 5) + PEB  │
│  net_collector      GetExtendedTcpTable/UdpTable (iphlpapi)  │
│  cpu_tracker        双快照 KernelTime/UserTime 差值          │
│  perf_collector     GlobalMemoryStatusEx + NtQuery(class 8)  │
│                     + GetLogicalDriveStrings + GetIfTable2   │
│  process_ops        OpenProcess + TerminateProcess           │
│  addon.cpp          Node-API 注册入口，导出全部函数           │
└──────────────────────────────────────────────────────────────┘
```

---

## 数据采集与 IPC 时序

```
hook 挂载          每 N 秒                        store 更新         React 重渲染
  │                  │                               │                    │
  │ setInterval ───→ ipc.fetchXxx() ──→ preload ──→ ipcRenderer.invoke │
  │ (默认 2s/进程,    │                  .invoke      │                    │
  │  3s/端口,         │                               │ setXxx(data)       │
  │  1s/性能；        │                               │ (Zustand merge)    │
  │  v1.8 起可调)     │                               │                    │
  │                  ↓                               ↓                    ↓
  │           main: ipcMain.handle ──→ native.xxx() ──→ JSON ──→ store ──→ UI
```

**各面板轮询间隔**（默认值，v1.8 起用户可在面板 header 调 1s/2s/5s/暂停，持久化到各 store）：
- 端口雷达：3s（端口变化不频繁）
- 进程：2s
- 性能：1s（曲线要顺滑）
- 被 mosaic 遮挡/整窗最小化的面板自动停止轮询（visibilityStore 广播，可见恢复时补一次刷新）

---

## 安全模型

| 边界 | 规则 | 原因 |
|------|------|------|
| 渲染层 ↔ native | 渲染层**绝不**直接 `require('codemgr-native')` | 渲染层可能加载不可信内容，直接暴露 native = RCE |
| 渲染层 ↔ ipcRenderer | preload 只暴露**封装后**的方法，不暴露 ipcRenderer | 限制可调用通道白名单 |
| contextIsolation | `true`（main.ts BrowserWindow 配置） | preload 与渲染页 JS 隔离 |
| nodeIntegration | `false`（main.ts BrowserWindow 配置） | 渲染层无 Node.js API |

所有跨边界调用必须经 `app/src/lib/ipc.ts` → `window.codemgr.*` → preload → ipcMain.handle → native。

---

## Native 采集层关键实现

### 进程采集（process_collector.cpp）
- `NtQuerySystemInformation(SystemProcessInformation = class 5)` 单次调用取全量进程链表。
- 缓冲区遇 `STATUS_INFO_LENGTH_MISMATCH` 倍增重试。
- 用自定义 `MY_SYSTEM_PROCESS_INFORMATION` 结构（不 include winternl.h，避免与它的 3 字段版冲突）。
- 命令行：`NtQueryInformationProcess(ProcessBasicInformation)` 拿 PEB → 读 `ProcessParameters`（PEB+0x20）→ 在偏移 0x60/0x68/0x70/0x78 启发式找 CommandLine UNICODE_STRING。

### 网络采集（net_collector.cpp）
- `GetExtendedTcpTable(TCP_TABLE_OWNER_PID_ALL)` + `GetExtendedUdpTable(UDP_TABLE_OWNER_PID)`，**IPv4 + IPv6 双枚举**（AF_INET/AF_INET6 各调一次，v1.8 起），inet_ntop 格式化地址。
- 连接带进程名：枚举后构建一次 pid→name 映射填充（不读 PEB，开销 < 2ms）。
- **include 顺序红线**：必须 `#define WIN32_LEAN_AND_MEAN` 后先 `winsock2.h` → `ws2tcpip.h` → `iphlpapi.h`，否则与 windows.h 的旧 winsock 冲突。

### 进程操作（process_ops.cpp）
- `killProcess` / `killByPids`（批量选中）/ `killByName`（全系统同名）/ `killTree`（递归进程树）。
- 所有 kill 路径过统一**保护名单**（系统关键进程 + 自身），防止误杀。

### 性能采集（perf_collector.cpp）
- 内存：`GlobalMemoryStatusEx`。
- CPU 总：`GetSystemTimes` 双快照。
- CPU 各核：`NtQuerySystemInformation(SystemProcessorPerformanceInformation = class 8)`，**缓冲区必须精确 = 核数×48 字节**，否则静默返回空。
- 网络：`GetIfTable2` 双快照算速率。

### 构建目标
- `pnpm build`（codemgr-native）：Node 目标，给 bench/test 用。
- `pnpm build:electron`（codemgr-native）：Electron 43.2.0 目标，给 app 用。**两者 ABI 不同，不可混用。**

---

## 状态管理（Zustand）

每个面板一个独立 store，互不依赖；布局/可见性/标签规则另有全局 store：

| Store | 文件 | 职责 |
|-------|------|------|
| portRadarStore | `store/portRadarStore.ts` | 连接列表 + 选中行 + loading + pollMs |
| processPanelStore | `store/processPanelStore.ts` | 进程列表 + cpuMap + filter/sort/expand/select + viewMode + pollMs |
| perfStore | `store/perfStore.ts` | 当前性能数据 + 60 点滚动历史 + pollMs |
| themeStore | `store/themeStore.ts` | 主题切换（dark/light，persist） |
| layoutStore | `store/layoutStore.ts` | react-mosaic 布局二叉树 + 预设（persist） |
| visibilityStore | `store/visibilityStore.ts` | 面板可见性广播（驱动轮询节流） |
| labelRulesStore | `store/labelRulesStore.ts` | 标签规则（默认+用户合并，persist） |

设计原则：store 只管状态，不管数据来源（来源在 hook）；组件只管渲染，不直接调 IPC。三个轮询 hook 从各自 store 订阅 pollMs（0=暂停），并响应 visibilityStore 的可见性变化。
