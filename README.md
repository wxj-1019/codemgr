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
| **批量 kill 同名进程** | ⚠️ 繁琐 | ✅ 一键 |

> 定位：**与 System Informer 互补，不是替代。** 你可以两个都装着用。

---

## ✨ 功能

### 端口雷达（首屏）
- 监听端口列表（TCP LISTENING + UDP），关联进程名/PID/命令行
- dev 常用端口（3000/5173/8080/3306/5432/27017…）自动打彩色标签
- 一键结束占用端口的进程（带二次确认）
- 3 秒自动刷新

### 进程面板
- **树形视图**：父子进程关系，展开/折叠
- **命令行智能标注**：`npm run dev` → dev server、`vite build` → 构建任务、`jest` → 测试、docker/postgres/mysql/redis 自动识别
- CPU% / 内存排序，搜索过滤（进程名/命令行/PID）
- 多选 + 批量结束同名进程
- 高内存（>500MB）/ 高 CPU（>50%）红黄警告

### 性能面板
- **CPU**：总使用率 60 秒实时曲线 + 各核心进度条
- **内存**：使用率曲线 + 已用/总量
- **磁盘**：每盘空间占用条（>70% 琥珀、>90% 红色警告）
- **网络**：活跃网卡实时收发速率

### 系统
- 托盘常驻（最小化/关闭隐藏到托盘，右键菜单）
- 全局快捷键 `Ctrl+Shift+M` 随时唤出
- 暗色 / 亮色主题切换

---

## 📸 截图

> TODO：v1.1 补充各面板截图。

---

## 📦 安装

### 从源码构建（当前唯一方式）

**前置依赖：**

| 依赖 | 版本 |
|------|------|
| Node.js | 22（见 `.nvmrc`） |
| pnpm | 8 |
| Visual Studio Build Tools | 2022（含 **C++ 桌面开发** + **CMake** 组件） |

```bash
git clone https://github.com/wxj-1019/codemgr.git
cd zenjiro-await
pnpm install          # 安装依赖 + 编译 native（Node 目标）+ 软链 pre-commit hook
pnpm build:electron   # 为 Electron 重编译 native（首次必跑）
pnpm start            # 生产模式启动
```

开发模式（热重载）：
```bash
pnpm dev
```

> 打包成安装包（.exe）是 v1.1 的范围，当前需从源码运行。

---

## 🛠 开发

### 常用命令

| 用途 | 命令 |
|------|------|
| 启动开发（热重载） | `pnpm dev` |
| 生产模式启动 | `pnpm start` |
| 全量构建 | `pnpm build` |
| 全部测试 | `pnpm test:native && cd app && pnpm vitest run` |
| 性能基准 | `pnpm bench` |
| 类型检查 | `cd app && pnpm typecheck` |

### 闭环工作流

本项目已建立完整的「issue → 分支 → 开发 → 验证 → PR → 发布」闭环：

- **AI 协作**：每次会话先读 [`AGENTS.md`](./AGENTS.md)（架构图 + 规范 + 避坑指南）
- **人类贡献**：读 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)
- **提交前**：pre-commit hook 自动跑增量 typecheck + test
- **CI**：GitHub Actions 自动跑 typecheck + test + build（Windows）

详见 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)。

---

## 🏗 架构

```
┌─ 渲染层 (Renderer) ──────────────────────────────────────┐
│  React 18 + TS + Tailwind + Zustand + Recharts           │
│  App.tsx ──┬─ PortRadar    (端口雷达, 首屏)               │
│            ├─ ProcessPanel (进程, 树形+标注)              │
│            └─ PerfPanel     (性能, 实时图表)              │
├─ contextBridge (安全边界) ───────────────────────────────┤
│  preload 暴露 window.codemgr.* (封装 API, 不暴露 ipcRenderer) │
├─ 主进程 (Main) ──────────────────────────────────────────┤
│  Electron: 窗口 + 托盘 + 全局快捷键 + ipcMain.handle     │
├─ require() ──────────────────────────────────────────────┤
│  codemgr-native (C++ Node-API addon)                     │
│  processScan / netScan / cpuDelta / perfCounters / kill  │
└──────────────────────────────────────────────────────────┘
```

**关键技术决策：**
- **采集层用 C++ 直读内核 API**（NtQuerySystemInformation / GetExtendedTcpTable），不是 PowerShell——后者全量轮询要数百毫秒，C++ 单次 < 10ms。
- **UI 层与采集层解耦**：UI 用最顺手的 Web 技术栈，性能瓶颈在采集层，两者分开优化。
- **安全红线**：渲染进程绝不直接 `require('codemgr-native')`，只通过 preload 暴露的封装 API。

完整架构详解见 [`docs/architecture.md`](./docs/architecture.md)，设计决策背景见 [`docs/superpowers/specs/`](./docs/superpowers/specs/)。

### 性能基线（v1.0 实测）

| 指标 | 实测 |
|------|------|
| processScan p99（真实 2s 轮询，327 进程） | 10.16 ms |
| netScan p99（233 连接） | 2.53 ms |
| 60 秒高频采集内存增长 | −6.21 MB（无泄漏） |

---

## 🧪 测试

| 层 | 工具 | 范围 |
|----|------|------|
| 渲染层（store/labels/纯函数） | Vitest | 4 文件，TDD |
| native 采集 | Vitest | 2 文件（process/net 正确性） |
| native 性能 | bench 脚本 | Go/No-Go 基准（process/net/leak） |

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

### v1.1（近期）
- [ ] 可拖拽面板布局
- [ ] 命令行智能识别规则可自定义（用户配置）
- [ ] 按进程查看环境变量（读 PEB env 块）
- [ ] 亮色主题完整适配
- [ ] 打包成安装包（electron-builder）

### v1.2
- [ ] 进程 CPU/内存历史记录（单进程曲线）
- [ ] 自定义列和排序预设

### v2.0（远期）
- [ ] 远程连接（查看其他机器）
- [ ] 插件系统
- [ ] 进程快照对比

完整 roadmap 见 [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)。

---

## 📄 许可证

[MIT](./LICENSE)

> 本项目借鉴了 [System Informer](https://github.com/winsiderss/systeminformer)（MIT）的 `phnt` 头文件数据结构定义。
