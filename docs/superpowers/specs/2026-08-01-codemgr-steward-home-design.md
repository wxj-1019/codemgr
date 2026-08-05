# 电脑管家首页（Steward Home）：性能与状态评估总览

日期：2026-08-01
状态：已批准（方向：首页 = 电脑性能/状态评估，产品隐喻「电脑管家」）
关联：`2026-07-29-codemgr-design.md`（定位）、`2026-07-31-codemgr-ux-audit.md`（UX 基线）、`2026-08-01-codemgr-display-consistency-design.md`（显示规范）

---

## 1. 背景与定位转向

用户明确产品方向：**以查看和优化系统性能为主，能处理电脑的进程/程序；首页 = 电脑的性能与状态评估——「电脑管家」**。

现状差距：应用打开是工作台多面板（首屏为端口雷达），没有总览页；PerfPanel 只能查看实时图表，无评估结论、无问题清单、无处理入口。产品叙事是「开发工件管理器」，与「电脑管家」隐喻不符。

## 2. 决策

- **新增「首页」面板**（BuiltInPanelId 第 8 个，id `home`），作为默认首屏。
- 首页 = 四区：**状态评估横幅 + 状态卡片 + 问题清单 + 快速动作**。
- **评估模型**（healthAssess）与**检测引擎**（issueDetector）为纯 TS 规则层，TDD，消费现有轮询数据，零 native 采集改动。
- 磁盘状态：新增 `system:diskUsage` IPC（native `diskVolumes()` 已存在，仅 main/preload/renderer 接线，无需重编译 native）。
- 信息架构：侧栏监控组重排为 首页/性能/进程/端口/启动项；工作流组（快照/AI 会话/Run Profiles）保持分组不动（折叠区属后续迭代，本轮不做）。

## 3. 首页设计

### 3.1 布局（四区，纵向）

```
┌────────────────────────────────────────────────┐
│ ① 状态评估横幅（分级 + 人话解释 + 更新时间）        │
├─────────┬─────────┬─────────┬─────────┬─────────┤
│ ② CPU   │ 内存     │ 磁盘     │ 网络     │ GPU     │  ← 状态卡片（响应式：≥960px 5 卡一行，<960px 2 卡换行）
├─────────┴─────────┴─────────┴─────────┴─────────┤
│ ③ 需要关注的问题（检测引擎输出，严重度排序）         │
│    ⚠ node.exe 持续占用 CPU 38%（3 分钟） [处理]    │
│    ⚠ C: 盘剩余 9%                       [处理]    │
├────────────────────────────────────────────────┤
│ ④ 快速动作：查看高占用进程 / 结束异常进程 / 打开详情  │
└────────────────────────────────────────────────┘
```

### 3.2 状态评估横幅（healthAssess）

**透明规则，非黑箱评分**：整体分级由「最差指标」主导 + 问题数修正，每次评估输出判定依据文案。

指标输入：
- `cpuPercent`：近期 CPU 均值（性能轮询已采集）
- `memPercent`：内存使用率（perfCounters 已有）
- `diskFreeMin`：所有盘中最小的剩余百分比
- `issueCount`：检测引擎当前问题数
- `gpuPercent`：GPU 引擎使用率（有 GPU 时；无 GPU 降级不参与）

单指标分级：`normal | attention | alert`
- CPU：<70 normal；70–85 attention；>85 alert
- 内存：<70 normal；70–85 attention；>85 alert
- 磁盘：>20 normal；10–20 attention；<10 alert
- GPU：<80 normal；80–90 attention；>90 alert

整体分级：`excellent | good | attention | alert`
1. 取所有指标中最差级（weakest link）
2. 若 `issueCount >= 2` 且整体非 alert，降一档（attention→good、good→excellent 不变）——异常数量修正
3. 输出 `{ level, reasons: string[] }`，reasons 列出所有触达最差级的指标人话描述（如「内存使用率 88%」「C: 盘剩余 9%」），横幅展示 level + reasons 摘要

### 3.3 状态卡片

每卡：指标名 + 当前值 + 状态色（normal=content-secondary / attention=warn / alert=danger）+ 简短趋势（CPU 相对上一采样、内存同）。点击卡片 → 打开对应详情（CPU/内存 → 性能面板；磁盘 → 无详情则禁用点击）。

### 3.4 检测引擎（issueDetector）

**纯函数规则引擎**，输入（perf 当前值、进程样本序列、磁盘列表），输出 `Issue[]`。每轮轮询调用，内部维护轻量状态（进程历史 ring buffer：pid → 最近 10 个 RSS/CPU 样本）。

| 规则 | 触发条件 | Issue 字段 |
|------|---------|-----------|
| 系统 CPU 持续高 | 系统 CPU 均值 >80% 连续 3 个轮询周期 | severity=alert, title=「系统 CPU 持续高占用」, action=open-perf |
| 单进程 CPU 异常 | 进程 `cpuPercent >= 100`（占满一核；字段语义为相对单核 0-100）连续 2 周期 | severity=attention, 含 processId, action=locate-process |
| 内存增长趋势 | 进程 RSS 最近 3 样本递增且总增幅 >15%（或 >200MB） | severity=attention, 含 processId, action=locate-process（泄漏信号） |
| 磁盘空间低 | 任一盘剩余 <10% | severity=alert, 含 disk 信息, action=open-details |

Issue 去重：同规则同实体（pid/盘符）只保留一条，状态变化时更新；消除后移除。
Issue 上限：最多 10 条，超出丢弃最低严重度（防刷屏）。

### 3.5 快速动作区

- 「查看高占用进程」→ 打开进程面板（CPU 排序激活）
- 「结束异常进程」→ 打开进程面板并选中 issueDetector 中 CPU/内存异常的进程（若仅一条则直接弹 kill 确认）
- 「打开性能详情」→ 打开性能面板

## 4. 数据流

```
轮询 hooks（usePerf/useProcessPanel/usePortRadar 既有）
        │ 每 2s（disk 每 5s 经 system:diskUsage）
        ▼
homeStore（Zustand，非持久化）
   ├─ 持有：最新 perf/进程/磁盘快照 + 历史样本
   ├─ 计算：healthAssess() + issueDetector()
   └─ 暴露：assessment / issues / cards
        ▼
HomePanel（渲染）
   └─ 动作 → 联动：openPanel + 进程选中（复用 processPanelStore / layoutStore 既有机制）
```

## 5. 磁盘数据（修订：免新增 IPC）

原计划新增 `system:diskUsage` IPC——实施前发现 `perfCounters()` 的 `PerfData.disks`（`{ name, totalBytes, freeBytes, readBytesPerSec, writeBytesPerSec, activePercent }`）已含剩余空间数据，首页磁盘卡与「磁盘空间低」检测**直接复用 perf 数据**，零 IPC/native 改动（spec §3.3 磁盘卡点击无详情，保持禁用）。

## 6. 信息架构与导航

- `panelCatalog.tsx`：新增 `home` 定义（title「首页」，图标 House/Home lucide，group `monitoring`，**排在监控组第一**）
- 默认首屏：`layoutStore` 的 classic 预设根节点改为 `home`（或 App 首启 `openPanel('home')`）；`WorkspaceZeroState` 恢复预设后首屏为 home
- 侧栏监控组顺序：首页 / 性能 / 进程 / 端口雷达 / 启动项（panelCatalog 数组顺序即侧栏顺序——home 插入到 port 前）
- 工作流组（快照 / AI 会话 / Run Profiles）本轮不动

## 7. 联动机制（复用既有）

- 问题项「处理」→ 进程：`layoutStore.openPanel('process')` + `processPanelStore` 选中该 pid（UX-16 进程↔端口联动同款模式）
- 无进程的问题（磁盘/系统 CPU）→ 打开性能面板
- 快速动作同理

## 8. 测试策略

- `healthAssess` 纯函数 TDD：分级表全组合（5 指标 × 3 级 + 修正规则 + reasons 文案）
- `issueDetector` TDD：模拟轮询序列（持续高 CPU 3 周期触发、2 周期不触发、内存单调增长触发、去重、消除、上限）
- `homeStore`：快照/计算触发测试
- `HomePanel` 渲染测试：mock IPC + ToastHost 挂载（沿用既有模式）；卡片/问题/动作渲染
- `panelCatalog`/`layoutStore`/workspaceNavigation 测试更新（8 面板、监控组新顺序、classic 预设根节点）
- 全量回归：app 593+ 新增测试，native 51 不变（native 未动）

## 9. 不做的事（本轮）

- 不做工作流组折叠区（后续迭代）
- 不做插件系统移除（代码保留，仅退出主界面叙事——本轮连导航都不动插件区）
- 不做性能优化动作的「一键体检」批处理（只做定位 + 既有 kill 能力闭环）
- 不做温度/电池/风扇等硬件传感器（native 无此数据源）
- 不改 native 采集层

## 10. 验收清单

- [ ] 应用启动默认打开首页（状态评估横幅 + 5 状态卡 + 问题清单 + 快速动作）
- [ ] 评估分级与 reasons 文案与规则表一致（测试覆盖全组合）
- [ ] 检测引擎在模拟高 CPU/内存增长/磁盘低时产出问题，消除后消失
- [ ] 问题项「处理」能打开进程面板并选中对应进程
- [ ] 磁盘卡显示真实剩余空间（system:diskUsage 接线完成）
- [ ] 监控组顺序为 首页/性能/进程/端口/启动项；工作流组不变
- [ ] app 全量测试通过（593 + 新增）、typecheck 干净、native 51 不变
