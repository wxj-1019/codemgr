<div align="center">

# CodeMgr

**面向开发者的 Windows 工作流管理器**

把进程当「开发工件」管，而不只是「系统资源」。

[功能](#-功能) · [截图](#-截图) · [安装](#-安装) · [开发](#-开发) · [架构](#-架构) · [参与贡献](#-参与贡献)

</div>

---

## 🎯 为什么造这个

Windows 自带任务管理器对开发者不友好：找端口占用要 `netstat -ano | findstr`，看清一串 node.exe 哪个是 dev server 要翻命令行，批量 kill 只能一个个点。

[System Informer](https://github.com/winsiderss/systeminformer) 已经把「进程当系统资源管理」做到极致（内核调试、内存编辑、反恶意软件）。CodeMgr **不与它竞争**，而是补齐它在「开发工件视角」上的空白：

| | System Informer | CodeMgr |
|---|:---:|:---:|
| 内核调试 / 内存编辑 | ✅ | ❌（不做） |
| 进程 / 网络 / 服务 基础能力 | ✅ 深 | ✅ 够用 |
| **端口→进程一键定位 + kill** | ⚠️ 要翻 | ✅ 首屏 |
| **进程按命令行智能标注**（dev server / test / build） | ❌ | ✅ |
| **进程按项目自动分组** | ❌ | ✅ |
| **按进程查看环境变量** | ❌ | ✅ |

> 定位：**与 System Informer 互补，不是替代。** 你可以两个都装着用。

---

## ✨ 功能

### 布局（react-mosaic 多面板）
- 三大面板（端口雷达/进程/性能）自由拆分、嵌套、拖拽、关闭，布局树持久化
- 3 个布局预设：经典 / 端口+性能 / 开发聚焦，一键切换
- 被遮挡/最小化的面板自动停止轮询（可见性节流）

### 端口雷达
- 监听端口列表（TCP/UDP，**含 IPv6**——绑 `::` 的 Vite/Node 不再漏），关联进程名/PID
- dev 常用端口（3000/5173/8080/3306/5432/27017…）自动打彩色标签
- 搜索过滤 + 端口冲突高亮
- 一键结束占用端口的进程（带二次确认 + 保护名单）

### 进程面板
- **树形视图** + **按项目分组**（同项目进程自动归类，可整组结束）
- **命令行智能标注**：`npm run dev` → dev server、`vite build` → 构建、`jest` → 测试；规则引擎**可自定义**（增删改/导入导出）
- **详情侧栏**（可拖宽）：完整命令行、精确工作目录（PEB 直读）、**环境变量查看**、单进程 CPU/内存 60s 曲线、运行时长/句柄数
- 排序/搜索/多选/批量结束（只杀选中项）/ 结束进程树 / 右键菜单
- 高内存（>500MB）/ 高 CPU（>50%）红黄警告
- **虚拟列表**：>100 行自动启用虚拟滚动，支持 2000+ 进程
- **键盘导航**：↑↓ 焦点 / Enter 选中 / Home/End 跳首尾，ARIA grid 语义

### 性能面板
- **CPU**：总使用率 60 秒实时曲线 + 各核心进度条
- **内存**：使用率曲线 + 已用/总量
- **磁盘**：空间占用条（>70% 琥珀、>90% 红色）+ 每盘读/写速率与活动时间%
- **网络**：活跃网卡实时收发速率

### 系统
- 托盘常驻 + 全局快捷键 `Ctrl+Shift+M` 唤出
- 暗色 / 亮色主题（完整适配），主题/排序/过滤/布局均持久化
- 每个面板刷新间隔可调（1s/2s/5s/暂停）
- 窗口位置/大小/最大化状态跨重启保留
- 全局 ErrorBoundary 防白屏，导航栏显示版本号

---

## 📸 截图

> 待补充：各面板截图（需在真机运行截取，见 #贡献）。

---

## 📦 安装

### 安装包（推荐）

从 [Releases](https://github.com/wxj-1019/codemgr/releases) 下载 `CodeMgr Setup.exe`（NSIS 安装向导，含卸载）。

> 未签名（个人项目无证书），Windows 首次运行会提示 SmartScreen 警告，选「仍要运行」即可。

### 从源码构建

**前置依赖：**

| 依赖 | 版本 |
|------|------|
| Node.js | 22（见 `.nvmrc`） |
| pnpm | 8 |
| Visual Studio Build Tools | 2022（含 **C++ 桌面开发** + **CMake** 组件） |

```bash
git clone https://github.com/wxj-1019/codemgr.git
cd codemgr
pnpm install          # 安装依赖 + 编译 native（Node 目标）+ 软链 pre-commit hook
pnpm build:electron   # 为 Electron 重编译 native（首次必跑）
pnpm start            # 生产模式启动
```

开发模式（热重载）：
```bash
pnpm dev
```

> 自己打包：`pnpm dist` 产出 NSIS 安装包（`release/CodeMgr Setup.exe`）。
> 注意：需关闭第三方杀软实时防护（否则打包时 exe 被锁）。

---

## 🛠 开发

### 常用命令

| 用途 | 命令 |
|------|------|
| 启动开发（热重载） | `pnpm dev` |
| 生产模式启动 | `pnpm start` |
| 全量构建 | `pnpm build` |
| 打包成安装包 | `pnpm dist` |
| 全部测试 | `pnpm test:native && cd app && pnpm vitest run` |
| 性能基准 | `pnpm bench` |
| 类型检查 | `cd app && pnpm typecheck` |

### 闭环工作流

本项目已建立完整的「issue → 分支 → 开发 → 验证 → PR → 发布」闭环：

- **AI 协作**：每次会话先读 [`AGENTS.md`](./AGENTS.md)（架构图 + 规范 + 避坑指南）
- **人类贡献**：读 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)
- **提交前**：pre-commit hook 自动跑增量 typecheck + test
- **CI**：GitHub Actions 自动跑 typecheck + test + build + bench 软 gate（Windows）

详见 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)。

---

## 🏗 架构

```
┌─ 渲染层 (Renderer) ──────────────────────────────────────┐
│  React 18 + TS + Tailwind + Zustand + Recharts           │
│  App.tsx ── react-mosaic 多面板布局（可拆分/拖拽）        │
│            ├─ PortRadar    (端口雷达)                     │
│            ├─ ProcessPanel (进程, 树形/项目分组/标注)     │
│            └─ PerfPanel     (性能, 实时图表)              │
├─ contextBridge (安全边界) ───────────────────────────────┤
│  preload 暴露 window.codemgr.* (封装 API, 不暴露 ipcRenderer) │
├─ 主进程 (Main) ──────────────────────────────────────────┤
│  Electron: 窗口 + 托盘 + 全局快捷键 + ipcMain.handle     │
├─ require() ──────────────────────────────────────────────┤
│  codemgr-native (C++ Node-API addon)                     │
│  processScan / netScan(IPv4+IPv6) / cpuDelta /           │
│  perfCounters / kill(Process|Pids|Tree|ByName) /         │
│  getProcessEnv / getProcessCwd                           │
└──────────────────────────────────────────────────────────┘
```

**关键技术决策：**
- **采集层用 C++ 直读内核 API**（NtQuerySystemInformation / GetExtendedTcpTable），不是 PowerShell——后者全量轮询要数百毫秒，C++ 单次 < 20ms。
- **UI 层与采集层解耦**：UI 用最顺手的 Web 技术栈，性能瓶颈在采集层，两者分开优化。
- **安全红线**：渲染进程绝不直接 `require('codemgr-native')`，只通过 preload 暴露的封装 API。

完整架构详解见 [`docs/architecture.md`](./docs/architecture.md)，设计决策背景见 [`docs/superpowers/specs/`](./docs/superpowers/specs/)。

### 性能基线

| 指标 | 实测 | 判据 |
|------|------|------|
| processScan p99（真实 2s 轮询，~400 进程） | 12.38 ms | < 20 ms |
| netScan p99（IPv4+IPv6 合并枚举） | 4.7~7.9 ms | < 30 ms |
| 60 秒高频采集内存增长 | 负增长（无泄漏） | < 10 MB |

> bench 对机器负载敏感（CI 为软 gate），判读时先做基线对照。

---

## 🧪 测试

| 层 | 工具 | 规模 |
|----|------|------|
| 渲染层（store/组件/纯函数） | Vitest + jsdom | 20 文件 / 160 用例 |
| native 采集 | Vitest | 5 文件 / 33 用例 |
| native 性能 | bench 脚本 | Go/No-Go 基准（process/net/leak） |

共 **193 PASS**。纯逻辑（store/labels/分组/格式化）一律 TDD，UI 人工验收。

```bash
pnpm test:native && cd app && pnpm vitest run   # 全部测试
pnpm bench                                       # 性能基准
```

---

## 🤝 参与贡献

欢迎贡献！请先阅读：

- [`AGENTS.md`](./AGENTS.md) — AI 协作指引（架构 + 规范 + 避坑）
- [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) — 人类贡献指南（闭环工作流 + 提交规范 + roadmap）

提交规范遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
```
feat(app): add process panel tree view
fix(native): correct cmdline PEB offset for Win11
```

---

## 📋 Roadmap

v1.0 ~ v1.8 已交付（端口雷达 / 项目分组 / 环境变量查看 / 标签规则引擎 / 安装包 / mosaic 布局 / IPv6 / 虚拟列表 / 键盘导航等），完整变更见 [`CHANGELOG.md`](./CHANGELOG.md)。

### v2.0（远期）
- [ ] 远程连接（查看其他机器）
- [ ] 插件系统
- [ ] 进程快照对比

完整 roadmap 见 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)。

---

## 📄 许可证

[MIT](./LICENSE)

> 本项目借鉴了 [System Informer](https://github.com/winsiderss/systeminformer)（MIT）的 `phnt` 头文件数据结构定义。
