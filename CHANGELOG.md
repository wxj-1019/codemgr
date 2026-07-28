# Changelog

本文件记录 CodeMgr 所有面向用户的变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased] — v1.0 优化迭代

### 新增
- **磁盘 IO 速率**：性能面板的磁盘子标签从「仅空间」升级为「空间 + 读/写速率 + 活动时间%」（PDH 计数器 `\LogicalDisk(*)\*`）。
- **统一加载/错误/空状态**（LoadState 组件）：三个面板（端口雷达/进程/性能）首屏骨架加载、出错提示 + 自动重试、空数据占位，体验一致。
- **组件测试**：LoadState / ConfirmDialog / PortTable 单元测试（+12 用例，共 40 PASS）。

### 优化
- **进程列表渲染性能**：ProcessRow 抽为 `React.memo` + 稳定 callback，预计算 childrenParentSet（O(n) 替代每行 O(n²)），300+ 进程时不必要重渲染大幅减少。
- **usePerf 错误处理**：补 setError，修复 perfStore.error 死字段。

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
