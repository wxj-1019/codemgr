# CodeMgr AI 开发者特性 — GPU 监控 + 进程快照对比 Spec

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 范围：两个面向"AI 开发程序员"日常场景的特性——GPU/显存监控（v2.1 主推）、进程快照对比（v2.2）。
> 前置阅读：`AGENTS.md`（架构红线）、`docs/superpowers/specs/2026-07-29-codemgr-design.md`（采集层设计）。

---

## 0. 为什么是这两个（场景溯源）

"用 AI agent 写代码的程序员"的日常：

1. **本地模型显存焦虑**：挂着 ollama/lmstudio/vLLM，最高频问题是"显存被谁占了、还剩多少"。CodeMgr 现在完全没有 GPU 维度——性能面板无 GPU 曲线，进程面板看不到 per-process VRAM。Windows 自带任务管理器有 GPU 列，SI 也有，CodeMgr 作为"开发者向"工具不能缺。
2. **agent 残留审计**：AI agent 跑一天，起了多少后台进程没人知道。"对比一下早上和现在的进程列表"是自然的清理入口——这正是 roadmap v2.0 的"进程快照对比"，提前兑现。

两个特性一攻（看得见资源）一守（清得掉残留），共同把"AI 开发工作台"定位坐实。

---

## 1. 特性一：GPU/显存监控（v2.1）

### 1.1 目标

- 性能面板新增 **GPU 子标签**：总使用率 60s 曲线 + 显存用量条（已用/总量）。
- 进程面板新增 **GPU% / 显存列**（可选列，默认开），排序支持。
- 采集挂 `perfCounters`（1s 节奏），**不进 `processScan` 热路径**（20ms 红线不动）。
- 环境不支持（虚拟机/远程桌面/旧驱动）时优雅降级，UI 显示"不可用"，不报错。

### 1.2 采集方案（决策 D5：PDH English counters）

候选方案对比：

| 方案 | 覆盖 | 缺点 | 结论 |
|------|------|------|------|
| **PDH GPU 计数器** | 总 GPU%、per-process GPU%、per-process 显存 | 实例名需解析；虚拟化环境可能为空 | ⭐ **选定** |
| DXGI `QueryVideoMemoryInfo` | adapter 级显存总量/用量 | 无 per-process、无使用率 | 辅助（显存总量） |
| NVML / ADL | NVIDIA/AMD 深度指标 | 厂商绑定、要分发 DLL | 不做 |
| ETW / D3DKMT | 最底层 | 复杂度高、文档少 | 不做 |

**PDH 细节（与现有 disk PDH 同模式，见 `perf_collector.cpp:94-116`）：**

- 用 `PdhAddEnglishCounterW`（Vista+）加计数器——**免本地化问题**（中文系统计数器名是本地化的，英文名路径只在 English API 下稳定）：
  - `\GPU Engine(*)\Utilization Percentage` — 每引擎实例使用率。实例名形如 `pid_1234_luid_0x00000000_0x00004501_phys_0_eng_2_engtype_3D`。
  - `\GPU Engine(*)\Dedicated Usage` — 每引擎实例专用显存（字节）。
- 通配符路径需先 `PdhExpandWildCardPath` 展开再逐个 `PdhAddEnglishCounter`；实例集合会变（进程进出），**每 5 个采样周期重新展开一次**（平衡开销与新鲜度）。
- **聚合逻辑**：
  - 总 GPU% = 所有实例 Utilization 之和 / 引擎数？——取"所有实例 sum 后 clamp 100"（任务管理器口径是" busiest engines 加权"，近似即可，spec 不追求精确一致）。
  - per-process：从实例名解析 `pid_(\d+)_` 前缀（**宽松解析**：只认 `pid_` 前缀 + 数字，其余段不假设格式——格式随 Windows 版本微变，这是风险 R1 的对策），按 pid 累加 GPU% 与 Dedicated Usage。
  - 显存总量：DXGI `IDXGIFactory4::EnumAdapters1` + `IDXGIAdapter3::QueryVideoMemoryInfo(DXGI_MEMORY_SEGMENT_GROUP_LOCAL)` 取 `CurrentUsage/ Budget`；取第一块硬件适配器。DXGI 失败时 fallback：per-process Dedicated Usage 求和作"已用"，总量显示"未知"。

**PdhAddEnglishCounter 的坑（写进实现注意）：**
- 该 API 要求计数器路径为英文且系统支持 English locale 名称注册（Win10 1709+ 全部支持）。
- `PdhExpandWildCardPath` 有 English 变体 `PdhExpandWildCardPath` 不分语言（展开的是已注册实例名），但为稳妥用 `PdhAddEnglishCounter` 逐个加展开后的路径。

### 1.3 数据模型与接线

```ts
// ipc-types.ts：PerfData 扩展（向后兼容的可选字段）
export interface PerfData {
  // ...existing...
  gpu: {
    available: boolean;          // false 时 UI 显示"不可用"
    totalPercent: number;        // 0-100
    vramUsedBytes: number;       // DXGI Local CurrentUsage
    vramBudgetBytes: number;     // DXGI Local Budget
    perProcess: Array<{ pid: number; gpuPercent: number; vramBytes: number }>;
  } | null;
}
```

- **不新增 IPC 通道**：并入 `perfCounters` 返回（1s 已有节奏，perProcess ~400 条 JSON 每秒钟一次可接受；实测若超 1ms 序列化开销则裁剪为 top 50）。
- 进程面板 GPU 列：从 `perfStore.gpu.perProcess` 按 pid 查表（store 已订阅 perf 数据，无需新轮询）。**注意**：进程面板可见性节流与 perf 面板独立——GPU 列只在 perf 轮询活跃时刷新；进程面板挂载而 perf 面板被遮挡时 GPU 列不更新。对策：GPU 列数据仍来自 perfStore，列头加 tooltip"数据来自性能面板轮询"；若 perf 暂停则显示上次值（可接受，文档说明）。

### 1.4 UI

- PerfPanel 加第 5 个子标签"GPU"：60s 曲线（复用 CPU 的 MiniChart 模式）+ 显存条（复用内存条样式，>70% 琥珀 >90% 红）+ "per-process Top 5 占用"小列表。
- ProcessTable 加 GPU% 列（`>50%` 红字警告，与 CPU 列同规则）+ 显存列（formatBytes）。排序 key 加 `gpu`。

### 1.5 测试策略

- **native 测试**（`tests/gpu.test.ts`）：结构断言——`gpu` 字段存在；若 `available=true` 则 totalPercent ∈ [0,100]、vramUsed ≤ budget × 1.1（budget 是软上限）、perProcess 每项 pid>0；若 `available=false`（CI/虚拟机）则其余字段为 0。**不做"必须 >0"断言**（环境无 GPU 负载时合法为 0）。
- **聚合逻辑纯函数抽出**：实例名→pid 解析（`parseGpuEnginePid("pid_1234_luid_...")`）+ per-pid 累加，在 native 测试用伪造实例名表驱动（不依赖真实 PDH）。
- **UI**：perfStore 处理 gpu=null 的降级渲染（jsdom 测试）；进程面板 GPU 列排序（沿用现有 sort 测试模式）。
- **bench**：perfCounters p99 基线 ~3ms，加 GPU 后判据 < 10ms。

### 1.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| R1 GPU Engine 实例名格式随 Windows 版本变化 | 中 | 宽松解析（只认 `pid_` 前缀）；解析失败归入"未知"不崩 |
| R2 虚拟机/远程桌面无 GPU 计数器 | 中 | `PdhExpandWildCardPath` 返回空 → `available=false` 降级 |
| R3 PDH 实例集过期（进程进出） | 低 | 每 5 周期重展开；过期实例聚合时跳过 |
| R4 多 GPU（核显+独显）聚合口径 | 低 | v2.1 聚合全部适配器；分卡显示留 v2.x |
| R5 PDH query 生命周期泄漏 | 低 | 与 disk PDH 同模式（进程生命周期内一次 Init，可接受） |

---

## 2. 特性二：进程快照对比（v2.2）

### 2.1 目标

- 一键对当前进程列表拍**命名快照**（"agent 开工前"）。
- 任意时刻对比"快照 vs 当前"（或两个快照）：**新增 / 已退出 / 有变化** 三组，按项目分组展示。
- 命中场景："AI agent 跑了一天后，系统里多了哪些残留进程"——added 组一键全选 → 批量结束（复用 killByPids）。

### 2.2 数据模型

```ts
// 快照条目 = ProcessInfo 的子集 + 元信息
interface SnapshotEntry {
  pid: number;
  createTimeMs: number;   // identity 的一部分（防 PID 复用误判）
  name: string;
  cmdline: string;
  cwd: string;
  workingSetBytes: number;
}
interface ProcessSnapshot {
  id: string;             // uuid
  name: string;           // 用户命名
  createdAt: number;      // Date.now()
  entries: SnapshotEntry[];
}
```

- **identity = pid + createTimeMs**（PID 会被系统复用，只用 pid 会把"旧进程退出+新进程同 pid"误判为"未变"）。
- **存储**：`userData/snapshots/*.json`（一快照一文件），经**受控文件 IO 通道**（v1.4 标签规则导入导出的同款模式：main 封装 fs，渲染层只收发数据）。通道：`snapshot:list / snapshot:save / snapshot:delete / snapshot:load`（list 只返回元信息，load 取全量）。
- 上限 20 个快照，超出提示删旧（防无限增长）。

### 2.3 Diff 逻辑（纯函数，TDD 核心）

```ts
// app/src/lib/snapshotDiff.ts
export interface SnapshotDiff {
  added: SnapshotEntry[];     // 当前有、快照无
  removed: SnapshotEntry[];   // 快照有、当前无
  changed: Array<{ before: SnapshotEntry; after: SnapshotEntry }>; // identity 相同但 name/cmdline 变化（罕见但存在：进程重 exec）
}
export function diffSnapshots(base: SnapshotEntry[], current: SnapshotEntry[]): SnapshotDiff;
```

- 匹配键：`${pid}:${createTimeMs}`。
- diff 结果按项目分组展示时复用 `projectGroup.ts` 的 `groupByProject`（SnapshotEntry 字段兼容 ProcessInfo 所需子集）。

### 2.4 UI（决策 D6：独立面板，挂 mosaic）

- 新面板 `SnapshotPanel`（注册进 `App.tsx` 的 PANELS 映射 + layoutStore 预设可选加入）：
  - 左栏：快照列表（命名/时间/进程数 + 拍快照/删除按钮）。
  - 主区：选中快照 → 与当前 diff（或选两个快照互比）。三组 tab：新增（红）/ 已退出（灰）/ 有变化（琥珀）。
  - "新增"组支持多选 + "结束选中"（killByPids + ConfirmDialog，复用现有模式）+ 按项目分组折叠。
- **不轮询**：快照是静态数据；"与当前对比"在面板可见时按需取一次 processScan，手动刷新按钮重取（不新增 interval——避免第 4 个轮询器）。

### 2.5 测试策略

- **diffSnapshots 纯函数 TDD**：added/removed/changed/identity（pid 相同 createTime 不同 → added+removed 而非 unchanged）、空快照、全等。
- **snapshotStore TDD**：list/save/delete、20 上限、选中态。
- **UI 人工验收**：拍快照 → 起/杀几个进程 → diff 三组正确 → 新增组批量结束。

### 2.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| 快照文件损坏 | 低 | load 时 JSON.parse try/catch + schema 校验，坏文件跳过并提示 |
| PID+createTime 仍理论可撞 | 低 | 可接受（窗口期内同 pid 同 createTime 概率为零） |
| 快照含敏感 cmdline | 低 | 存 userData（本机用户目录），与标签规则同级，无新增暴露面 |

---

## 已确认决策（2026-07-30 锁定）

| 编号 | 决策 | 选定 | 影响 |
|------|------|------|------|
| **D5** | GPU 采集方案 | **PDH English counters（GPU Engine）+ DXGI 显存辅助** | 免本地化、免厂商绑定；实例名宽松解析 |
| **D6** | 快照对比 UI 形态 | **独立面板挂 mosaic**（非 ProcessPanel 模式切换） | 不侵入进程面板；复用布局系统 |
| **D7** | 快照存储 | **受控文件 IO 通道 + userData/snapshots/** | 复用 v1.4 文件 IO 模式，守安全红线 |

## 排期

| 版本 | 内容 | 工作量 | 依赖 |
|------|------|:---:|------|
| **v2.1** | GPU/显存监控（native + perf 子标签 + 进程列） | 中 | 无（native 新 collector 独立文件） |
| **v2.2** | 进程快照对比（diff 引擎 + 文件 IO + SnapshotPanel） | 中 | v1.8 的布局/多选/killByPids 均已就位 |

## 明确不做

- 分 GPU 卡（多适配器）明细、GPU 温度/功耗（NVML 领域）、 per-engine 细分（3D/Copy/Video）——v2.x 再议。
- 快照云同步/导出分享——个人本地工具，无此场景。
- 快照自动定时拍摄——手动为主，自动拍摄留作后续小迭代（CronCreate 式调度在 main 加一个 timer 即可，不急）。
