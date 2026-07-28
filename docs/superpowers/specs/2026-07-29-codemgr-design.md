# CodeMgr — 开发者工作流管理器 设计文档（C' 方案）

> 版本: v2.0 | 日期: 2026-07-29 | 状态: 设计阶段
> 修订说明: 本版推翻 v1.0 的"全功能任务管理器 + PowerShell 采集"定位。
> 经过竞品调研（System Informer 等）后，重新定位为**开发者工作流管理器**，
> 并把采集层从 PowerShell 改为 C++ 原生模块。定位与技术栈均经过修正。

---

## 0. 为什么是这份设计（决策溯源）

### 0.1 重新定位：不做"更全的任务管理器"

竞品调研发现 [System Informer](https://github.com/winsiderss/systeminformer)（原 Process Hacker，MIT 许可、15.5k★、活跃维护）已经把"进程/网络/服务/内核级调试"做到了极高完成度。任何"复刻一个更全的任务管理器"的尝试，结果都只会是它的功能子集、性能更差、内存更高——这是 pre-mortem 暴露的头号死因。

因此 CodeMgr 的定位**不是竞品，而是互补**：

> **System Informer 把进程当"系统资源"管理；CodeMgr 把进程当"开发工件"管理。**
>
> 进程/性能/网络这些基础能力，CodeMgr 做到够用即可；
> 全部精力押在 SI 故意没做、开发者天天遇到的"开发工作流"视角上。

### 0.2 重新选型：采集层 ≠ UI 层

v1.0 的 PowerShell 采集是真实性能瓶颈（全量轮询 2000+ 进程需数百 ms）。但这**不是 Web 技术栈的锅**，是采集层的锅。Web UI 层本身没有性能问题。

C' 方案的关键改进：**UI 层用最顺手的 Web 技术栈，采集层用 C++ 原生模块直读内核结构**，二者解耦。这样既保留 Web 的开发速度，又拿到原生采集的性能。

### 0.3 "借鉴已有项目"的字面落地

借鉴体现在两处：
1. **数据结构**：C++ 采集层参考 SI 的 `phnt` 头文件（MIT 许可，可复用）
2. **采集思路**：`NtQuerySystemInformation` 单次调用取全量进程，CPU% 用双快照差值——这是 SI/Process Explorer 的通用做法

---

## 1. 产品概述

**CodeMgr** 是一款面向 Windows 开发者的工作流管理器。它不追求替代 System Informer，而是补齐后者在"开发工件视角"上的空白：端口被哪个 dev server 占了、哪些进程属于同一个项目、怎么一键清掉所有 node.exe、某进程实际继承了哪些环境变量。

### 差异化定位（vs System Informer）

| 能力 | System Informer | CodeMgr |
|------|:---:|:---:|
| 内核级调试、内存编辑、反恶意软件 | ✅ | ❌（不做） |
| 进程/网络/服务 基础能力 | ✅ 深 | ✅ 够用 |
| **端口雷达**（端口→进程，一键 kill） | ⚠️ 需翻 Network | ✅ 一级入口 |
| **dev 进程自动分组**（按项目归类） | ❌ | ✅ 核心 |
| **批量 kill 同名进程** | ⚠️ 繁琐 | ✅ 一键 |
| **命令行智能解析**（标 dev server / 构建 / 测试） | ❌ | ✅ 核心 |
| **环境变量按进程继承查看** | ❌ | ✅ |

### 核心目标
- 聚焦开发者高频场景，不为"全面"与 SI 竞争
- UI 响应及时，采集性能接近原生
- 经典标签页布局，v1 不做面板拖拽，后续迭代加入

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                    Electron Renderer                      │
│              (React 18 + TypeScript + Tailwind)           │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐  │
│   │端口雷达 │ │进程面板 │ │性能面板 │ │开发者工具     │  │
│   │(首屏)   │ │         │ │         │ │               │  │
│   └─────────┘ └─────────┘ └─────────┘ └───────────────┘  │
│                  Zustand Store                            │
├──────────────────────── contextBridge (IPC) ─────────────┤
│                    Electron Main                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              CollectorManager (TS)                  │  │
│  │   定时调度 + 缓存 + 差分推送                        │  │
│  └───────────────────────┬────────────────────────────┘  │
│                          │ require('codemgr-native.node') │
│  ┌───────────────────────▼────────────────────────────┐  │
│  │           codemgr-native (C++ Node-API addon)      │  │
│  │  process_scan()  → NtQuerySystemInformation        │  │
│  │  cpu_delta()     → KernelTime/UserTime 双快照      │  │
│  │  net_scan()      → GetExtendedTcpTable/UdpTable    │  │
│  │  perf_counters() → PdhHlng API                     │  │
│  │  kill_process() / kill_tree() / kill_by_name()     │  │
│  │  * 数据结构参考 SI 的 phnt 头文件 (MIT)            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 三层职责

| 层 | 技术 | 职责 | 关键约束 |
|----|------|------|---------|
| **UI 层**（Renderer） | React + TS + Tailwind | 展示、交互、状态 | 只渲染，不采集 |
| **调度层**（Main TS） | Electron main + ipcMain | 定时调度、缓存、差分 | 按面板独立间隔 |
| **采集层**（C++ addon） | Node-API + node-addon-api | 直读 Win32/内核 | 单次调用取全量 |

数据流：**C++ addon 单次采集 → Main 缓存+差分 → IPC JSON 推送 → Renderer Store → React**

---

## 3. 面板设计

> 首屏从 v1 的"进程面板"改为"**端口雷达**"——这是开发者最高频、SI 最不顺手的场景，作为差异化首屏。

### 3.1 端口雷达（首屏 / 差异化核心）

```
┌──────────────────────────────────────────────────┐
│  🔍 端口/进程名过滤...        [仅监听] [仅占用]  │
├──────────────────────────────────────────────────┤
│  端口   │ 协议 │ 状态   │ 进程        │ PID  │ 操作│
│  3000   │ TCP  │ 监听   │ node        │ 9012 │ ⚔  │  ← dev server
│  5173   │ TCP  │ 监听   │ node        │ 9034 │ ⚔  │  ← vite
│  3306   │ TCP  │ 监听   │ mysqld      │ 3456 │ ⚔  │  ← 数据库
│  8080   │ TCP  │ 监听   │ java        │ 4567 │ ⚔  │
│  27017  │ TCP  │ 监听   │ mongod      │ 5678 │ ⚔  │
├──────────────────────────────────────────────────┤
│  5 个监听端口 │ 已标注 dev server 2 个             │
│  [一键清空所有 node 进程]                         │
└──────────────────────────────────────────────────┘
```

| 功能 | 说明 |
|------|------|
| **端口→进程定位** | 这是开发者最高频痛点（"谁占了我 3000 端口"），做成一级入口 |
| **dev server 识别** | 命令行匹配 node/vite/webpack/python -m 等，自动标注 |
| **一键 kill** | 单进程 kill、按端口 kill、按进程名批量 kill |
| **端口冲突高亮** | 同端口多进程、或已知常用端口被非预期进程占用时标红 |
| **常用端口标签** | 3000/5173/8080/3306 等自动打"dev 常用"标记 |

### 3.2 进程面板（开发工件视角）

```
┌──────────────────────────────────────────────────┐
│  🔍 搜索进程/命令行...  [按项目分组] [树形]      │
├──────────────────────────────────────────────────┤
│  ▼ 📁 my-app (项目)                              │
│    ├─ node     │ npm run dev   │ dev server      │
│    ├─ node     │ vite          │ 构建工具        │
│    └─ node     │ jest          │ 测试            │
│  ▼ 📁 backend-api                               │
│    ├─ python   │ manage.py     │ django dev      │
│    └─ postgres │ pg_ctl        │ 数据库          │
│  ▼ 未分组                                       │
│    ├─ chrome   │ ...           │                 │
│    └─ Explorer │ ...           │                 │
├──────────────────────────────────────────────────┤
│  选中: node (PID 5678)                           │
│  [kill] [kill 进程树] [定位文件] [复制命令行]    │
└──────────────────────────────────────────────────┘
```

| 功能 | 说明 |
|------|------|
| **按项目分组** | **核心差异化**：通过命令行中的工作目录 / 项目标记，自动把同项目进程归组 |
| **命令行智能标注** | `npm run dev`→"dev server"；`vite build`→"构建"；`jest`→"测试" |
| **进程树** | 父子关系，默认按项目折叠 |
| **批量 kill 同名** | 一键结束所有 `node.exe` / 所有某项目进程 |
| **搜索过滤** | 进程名、PID、命令行模糊匹配 |
| **高亮染色** | 内存 > 500MB 黄，CPU > 50% 红 |
| **虚拟列表** | 进程数 > 100 时启用 @tanstack/react-virtual |
| **刷新间隔** | 默认 2s，可选 1s / 2s / 5s / 暂停 |

### 3.3 性能面板（够用即可，不与 SI 竞争）

```
┌──────────────────────────────────────────────────┐
│  [CPU] [内存] [磁盘] [网络]                       │
├──────────────────────────────────────────────────┤
│   CPU 使用率                    当前: 23%         │
│   ┌──────────────────────────────────────────┐   │
│   │  ▁▂▁▃▄▂▁▃▅▇█▇▅▃▁▂▃▄▂▁▂▃  (60s 实时曲线)│   │
│   └──────────────────────────────────────────┘   │
│   进程: 187 │ 线程: 2147 │ 句柄: 83412           │
└──────────────────────────────────────────────────┘
```

| 子面板 | 指标 | 来源 |
|--------|------|------|
| CPU | 总使用率、各核使用率、进程/线程/句柄数 | `NtQuerySystemInformation` + 双快照差值 |
| 内存 | 总量/已用/可用、提交量 | `GlobalMemoryStatusEx` |
| 磁盘 | 每盘读写速度 | PDH 计数器 |
| 网络 | 每网卡收发速度 | `GetIfTable` / PDH |

- 刷新间隔 1s，60s 滚动窗口
- **明确不做** SI 擅长的：内存编辑、内核对象浏览、线程栈追踪

### 3.4 开发者工具面板

```
┌──────────────────────────────────────────────────┐
│  [环境变量] [服务] [启动项]                       │
├──────────────────────────────────────────────────┤
│  ★ 环境变量（按进程继承查看 —— SI 没有的独特能力）│
│     选中某进程 → 显示它实际继承的 env 变量全集    │
│     区分 系统变量 / 用户变量 / 进程自设          │
│  ★ 服务管理（够用：列出、启停）                   │
│  ★ 启动项（注册表 Run + Startup 文件夹）          │
└──────────────────────────────────────────────────┘
```

- **按进程查看环境变量**是独特点：通过读取目标进程 PEB 的环境变量块，展示它实际继承的变量（调试"为什么我的进程读不到这个 env"的神器）
- 操作类加二次确认

---

## 4. 采集层设计（C++ 原生模块）

这是 C' 方案相对 v1 的核心改动，单独成节。

### 4.1 模块结构

```
codemgr-native/
├── binding.gyp              # node-gyp 构建配置
├── index.js                 # TS 类型声明入口
├── src/
│   ├── addon.cpp            # Node-API 注册入口
│   ├── process_collector.cpp  # NtQuerySystemInformation
│   ├── cpu_tracker.cpp        # 双快照 CPU% 计算
│   ├── net_collector.cpp      # GetExtendedTcpTable/UdpTable
│   ├── perf_collector.cpp     # PDH 性能计数器
│   ├── env_reader.cpp         # 读进程 PEB 环境变量块
│   └── process_ops.cpp        # kill / kill_tree / kill_by_name
└── package.json             # 依赖 node-addon-api
```

### 4.2 核心 API（暴露给 Main 进程）

```typescript
// codemgr-native 的 TS 接口
interface NativeBindings {
  // 进程全量快照（单次 NtQuerySystemInformation 调用）
  processScan(): ProcessSnapshot[];
  // CPU% 计算（需两次调用取差值，内部维护上次快照）
  cpuDelta(): CpuUsage[];  // [{ pid, cpuPercent }]
  // 网络连接
  netScan(): NetConnection[];
  // 性能计数器
  perfCounters(): PerfData;
  // 读某进程的环境变量块
  readProcessEnv(pid: number): Record<string, string>;
  // 进程操作
  killProcess(pid: number): boolean;
  killTree(pid: number): boolean;
  killByName(name: string): number;  // 返回 killed 数量
}
```

### 4.3 性能要点

| 操作 | 实现方式 | 预期耗时 |
|------|---------|---------|
| 进程全量列表 | `NtQuerySystemInformation(SystemProcessInformation)` 单次调用 | < 5ms（2000 进程） |
| CPU% | `KernelTime`+`UserTime` 双快照差值 / 系统时间 | < 1ms |
| 网络连接 | `GetExtendedTcpTable` / `GetExtendedUdpTable` | < 10ms |
| 环境变量读取 | `NtQueryInformationProcess` 读 PEB | < 5ms/进程 |

对比 PowerShell `Get-Process` 全量轮询数百 ms，C++ 直读快 1-2 个数量级。

### 4.4 构建与集成

- 用 **node-addon-api**（C++ wrapper，ABI 稳定，优于直接绑 V8/NAN）
- 用 **@electron/rebuild** 针对 Electron 的 Node 版本重编译
- 用 **node-gyp** + Visual Studio Build Tools 构建
- 产物 `codemgr-native.node` 通过 `require()` 加载

### 4.5 许可证合规

- SI 的 `phnt` 头文件为 **MIT 许可**，可直接复用数据结构定义
- 复用时在 NOTICE / LICENSE 中保留 SI 的版权声明

---

## 5. IPC 与调度

### 5.1 采集调度（Main 进程）

```typescript
// 采集器独立间隔，避免互相拖累
const collectors = {
  portRadar:  { interval: 3000, fn: native.netScan },      // 端口变化不频繁
  processes:  { interval: 2000, fn: native.processScan },  // 默认 2s
  cpuDelta:   { interval: 1000, fn: native.cpuDelta },     // 性能要顺滑
  perf:       { interval: 1000, fn: native.perfCounters },
  env:        { interval: 0,     fn: native.readProcessEnv }, // 按需，不轮询
};
```

### 5.2 IPC 协议（带差分推送）

```json
// Main → Renderer（仅推送变化的部分）
{
  "channel": "data:processes",
  "ts": 1722240000000,
  "diff": {
    "added":   [{ "pid": 5678, "name": "node", ... }],
    "removed": [1234],
    "updated": [{ "pid": 9012, "cpu": 2.1, "memory": 188743680 }]
  }
}
```

- 全量首推，后续仅推 diff，减少 IPC 序列化与渲染压力
- Renderer 端 Store 做 merge

---

## 6. 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Electron | 28+ |
| 前端 | React + TypeScript | 18 |
| 样式 | Tailwind CSS | 3 |
| 状态管理 | Zustand | 4 |
| 图表 | Recharts | 2 |
| 虚拟列表 | @tanstack/react-virtual | 3 |
| **采集层** | **C++ + Node-API (node-addon-api)** | **C++17** |
| 构建工具 | node-gyp + Visual Studio Build Tools | - |
| 重编译 | @electron/rebuild | - |
| 打包 | electron-builder (NSIS) | 24 |
| 测试 | Vitest (TS 层) + 手动 (C++ 层) | - |
| 包管理 | pnpm | 8+ |

### 主题
- 默认暗色（深灰底 + 青绿强调），可选亮色

---

## 7. 非功能需求

| 维度 | 目标 |
|------|------|
| 启动时间 | < 3s |
| 内存占用 | 空闲 < 200MB（Electron 基线 + 采集层） |
| 进程列表容量 | 支持 2000+ 进程（虚拟滚动） |
| 采集延迟 | 单次采集 < 20ms（vs PowerShell 数百 ms） |
| 系统支持 | Windows 10 / 11（x64） |
| 权限 | 默认普通权限；读他人进程 env、kill 需视情况提示提权 |

---

## 8. 版本规划

### v0.1 — 采集层验证（最高优先，先证伪头号风险）
- [ ] C++ addon 骨架 + `processScan()` 跑通
- [ ] 验证：2000 进程采集 < 20ms（若不达标，整个 C' 方案要重新评估）
- [ ] **这是 pre-mortem 头号假设的快速实验，先跑通再谈 UI**

### v1.0（MVP）
- [ ] 端口雷达（首屏差异化）
- [ ] 进程面板（按项目分组）
- [ ] 性能面板（基础四指标）
- [ ] 暗色/亮色主题
- [ ] 系统托盘常驻 + 全局快捷键

### v1.1
- [ ] 可拖拽面板布局
- [ ] 命令行智能识别规则可自定义
- [ ] 按进程查看环境变量

### v2.0
- [ ] 插件系统
- [ ] 进程快照对比（"我重启前后多了哪些进程"）

---

## 9. 风险与对策

| 风险 | 等级 | 对策 |
|------|:---:|------|
| **C++ addon 是你（若不熟 C++）的学习成本** | 高 | v0.1 先做最小验证；phnt 头文件 + 网上 NtQuerySystemInformation 范例可大幅降低门槛 |
| **C++ 采集性能不达标** | 高 | v0.1 即验证；若 < 20ms 不可达，降级到 Pdh/Toolhelp32 仍优于 PowerShell |
| **开发者真的需要"按项目分组"吗**（pre-mortem 头号） | 高 | v0.1 完成后自己用一周，记录哪些场景真的用了分组 |
| Electron 内存占用 | 中 | 限制渲染进程；不可见面板暂停采集 |
| Windows 权限不足 | 中 | 启动检测，提示以管理员运行 |
| 杀软误报（读 PEB 像恶意软件） | 中 | 读 env 功能默认关闭，按需开启；加数字签名 |

---

## 10. 与 v1.0 的差异对照

| 维度 | v1.0（已废弃） | v2.0 / C' |
|------|------|------|
| 定位 | 更全的任务管理器 | 开发者工作流管理器（与 SI 互补） |
| 首屏 | 进程面板 | **端口雷达** |
| 采集层 | PowerShell（慢） | **C++ 原生模块（快 1-2 数量级）** |
| 差异化 | 模糊（和 SI 撞功能） | **明确（dev 工作流视角）** |
| UI 技术栈 | React/TS | React/TS（保留） |
| 风险头号 | Electron 内存 | **C++ 学习成本 + 差异化假设真伪** |

---

## 附：关键参考

- [System Informer](https://github.com/winsiderss/systeminformer) — MIT，借鉴数据结构与采集思路
- [Electron 原生代码教程](https://electronjs.org/docs/latest/tutorial/native-code-and-electron)
- [@electron/rebuild](https://www.npmjs.com/package/@electron/rebuild)
- [Node-API 文档](https://nodejs.org/api/n-api.html)
- [NtQuerySystemInformation 进程枚举例程](https://gist.github.com/TheWover/71079af504ba8e056c9ebbe017d288a0)
