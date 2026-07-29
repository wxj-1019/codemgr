# 插件系统安全沙箱选型 Spike（roadmap F1）

> 日期：2026-07-29
> 关联：`docs/superpowers/specs/2026-07-29-codemgr-roadmap-proposals.md` §6（方案 6）
> 性质：**架构决策前置调研**（roadmap F1 门禁——安全模型必须先 review 通过才允许开工 6b/6c）
> 结论：分阶段混合方案——**6b 用 iframe sandbox，6c 用 UtilityProcess**，Worker 降级为标签规则的纯逻辑执行环境。

---

## 1. CodeMgr 现状约束（选型前提）

| 约束 | 现状 | 对插件的影响 |
|------|------|------------|
| `contextIsolation` | `true`（main.ts:46） | preload 与页面世界隔离；插件拿不到 preload 注入的对象 |
| `nodeIntegration` | `false`（main.ts:47） | 渲染进程无 Node；插件无法 `require()` |
| native 访问 | 仅经 preload `window.codemgr.*`（preload.ts） | 插件要碰 native 必须走受控 API，不能旁路 |
| 红线（spec §6.3.2） | 插件绝不直接 `require('codemgr-native')` 或访问 `ipcRenderer` | 沙箱必须从结构上保证这一点，而非靠约定 |

## 2. 三种方案的技术事实（调研结论）

### 2.1 iframe sandbox

**机制**：插件代码跑在 `<iframe sandbox="allow-scripts">`（**不给** `allow-same-origin`）。

- **安全性**：独立 origin，天然无 Node/Electron API。`allow-scripts` + 不给 `allow-same-origin` 是安全组合（MDN 警告：两者同时给会让 iframe 自行移除 sandbox，等于无沙箱）。
- **能渲染 UI**：✅ 这是 iframe 相对 Worker 的决定性优势——插件可在 iframe 内跑完整 React 应用，贡献可视面板/视图。
- **通信**：`postMessage`（parent ↔ iframe.contentWindow），需校验 `event.origin`。有序列化开销，但插件通信频率低（标签规则注册、只读快照轮询），可接受。
- **崩溃隔离**：iframe 崩溃不影响主框架（独立文档上下文）。
- **限制**：iframe 内的样式与主框架隔离（需另行同步主题——v1.7 的 CSS 变量体系可作为 postMessage 同步主题的来源）。

### 2.2 Web Worker + Comlink

**机制**：插件逻辑跑在 Worker，经 Comlink 暴露方法。

- **安全性**：Worker 默认**无 Node/Electron API**（Electron 文档：内置模块在多线程环境完全不可用，含 ipcRenderer）。要 Node 需 `nodeIntegrationInWorker: true` + **关 sandbox**——这会破坏 CodeMgr 的安全配置，**不可接受**。
- **不能渲染 UI**：❌ Worker 无 DOM，无法贡献可视视图。这是 6b"贡献只读视图"需求的致命短板。
- **适合**：纯计算型插件（如标签规则的批量正则匹配 offload 到后台线程）。
- **通信**：Comlink 包装 `postMessage`，调用体验近本地（async 方法）。

### 2.3 Electron UtilityProcess

**机制**：主进程侧的 Node.js 子进程（Chromium Services API），经 MessagePort 通信。

- **安全性**：进程级隔离最强。崩溃主进程可监听 `exit`/`error` 事件，`child.kill()` 可杀。
- **能加载 native 模块**：✅ 这是 6c"自定义数据源"（需 native 能力）的关键——但 CodeMgr 红线要求"不能插件自带 .node，新 native 能力必须主仓库 review 加入白名单"。UtilityProcess 提供了"白名单 native 能力的安全承载点"。
- **不直接渲染 UI**：在主进程侧，UI 要经 MessagePort 桥接回渲染层（远程组件模式），链路复杂。
- **开销**：独立进程 + Node 实例，内存重。6b 阶段（标签规则 + 只读视图）用它是杀鸡用牛刀。

## 3. 三方案对比矩阵

| 维度 | iframe sandbox | Worker + Comlink | UtilityProcess |
|------|:---:|:---:|:---:|
| **安全（结构保证无 native）** | ✅ 强 | ✅ 强（默认无 Node） | ⚠️ 中（有 Node，靠白名单约束） |
| **能渲染 UI / 贡献视图（6b）** | ✅ | ❌ 无 DOM | ⚠️ 需远程组件桥接 |
| **崩溃隔离** | ✅ | ✅ | ✅ 最强（进程级） |
| **承载 native 数据源（6c）** | ❌ | ❌ | ✅ |
| **通信开销** | 中（postMessage） | 低（Comlink） | 中（MessagePort） |
| **资源开销** | 低 | 低 | 高（独立进程） |
| **与 CodeMgr 现有安全配置兼容** | ✅ 无需改 | ✅ 无需改 | ✅ 无需改 |

## 4. 选型结论：分阶段混合（推荐）

spec §6.3.1 本就将插件分三阶段（6a/6b/6c），各阶段安全需求不同。**单一方案无法同时满足"能渲染视图"和"能承载 native 数据源"**，因此推荐按阶段匹配：

| 阶段 | 选定方案 | 理由 |
|------|---------|------|
| **6a（已完成）** | 标签规则（配置型） | 方案 2 已落地，零额外工作 |
| **6b（v2.0 初）** | **iframe sandbox** | 唯一能"既最安全又可贡献视图"的方案。Worker 因无 DOM 无法满足 6b 的视图需求；UtilityProcess 在此阶段过重 |
| **6c（v2.0+）** | **UtilityProcess**（仅当插件需新 native 能力时） | 进程级隔离 + 可加载白名单 native 模块。插件贡献的数据源经 MessagePort 回流渲染层 |

**Worker 的降级角色**：不作为主沙箱，但可用于 6b 阶段把"标签规则的正则批量匹配"offload 到 Worker（纯逻辑、无 UI、无 native），作为主框架自身的性能优化，不暴露给插件。

## 5. 受控 API 契约（6b，iframe sandbox 下）

iframe 内插件经 `postMessage` 获得的能力（结构上无法旁路）：

```ts
// 主框架 → iframe：推送只读快照 + 主题
type HostToPlugin =
  | { type: 'snapshot'; processes: ReadonlyProcessInfo[]; ports: ReadonlyConnection[] }
  | { type: 'theme'; vars: Record<string, string> };  // v1.7 CSS 变量体系

// iframe → 主框架：注册能力（受控，不暴露 ipcRenderer）
type PluginToHost =
  | { type: 'registerLabelRules'; rules: PluginLabelRule[] }
  | { type: 'ready' };
```

**关键约束**：
- 只读快照由主框架主动推送（按轮询节奏，iframe 不能主动拉——防止插件高频触发 native 调用）。
- 插件**不能**主动发起 IPC（只能 registerLabelRules / ready）。
- 数据源（6c）才放开 UtilityProcess 通道，且每个 native 能力单独白名单。

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|------|:---:|------|
| iframe sandbox 配置错误（误给 allow-same-origin） | 高 | code review 门禁 + 封装单一 `<PluginFrame>` 组件统一签发 sandbox 属性 |
| 插件 postMessage 风暴拖垮主框架 | 中 | 主框架侧节流（推送快照频率上限）+ iframe 侧不响应高频消息 |
| 主题不同步（iframe 样式与主框架割裂） | 中 | postMessage 同步 v1.7 CSS 变量；插件用变量而非硬编码色值 |
| UtilityProcess native 模块逃逸（6c） | 高 | 白名单机制——每个 native 能力主仓库 review 后编译进主包，插件不能自带 .node |
| 插件 API 设计反复（roadmap R8） | 中 | 6b 先冻结最小 API（snapshot + registerLabelRules），让方案 2 沉淀 6-12 月再扩 |

## 7. PoC 验证结果（2026-07-29，已实证）

PoC 在 CodeMgr 目标环境（Electron 43 / Chromium）实测，4 项全部通过。验证脚本：`app/poc-plugin-sandbox/`（host.html 主框架 + plugin.html 沙箱内 React + run-poc.mjs 用 Electron webContents 自动化）。

> **方法学**：iframe sandbox 无 `allow-same-origin` 时，iframe 是跨 origin 的——主框架**无法直接读取 iframe DOM**（实测抛 `Blocked a frame from accessing a cross-origin frame`）。这是预期且理想的行为（结构隔离）。因此渲染/主题结果由 iframe 经 postMessage **主动上报**，主框架不下探。

| PoC | 验证项 | 实测结果 | 结论 |
|:---:|--------|---------|:---:|
| ① | iframe sandbox 内跑 React，经 postMessage 接收快照渲染 | 渲染 2 张卡片（node.exe/vite.exe），`render-report` 正确上报 | ✅ |
| ② | 结构验证 iframe 内无 Node/Electron | `require`/`window.codemgr`/`process`/`ipcRenderer`/`global` **全为 undefined** | ✅ **红线从结构上保证** |
| ③ | CSS 变量主题经 postMessage 同步到 iframe | iframe 应用 `--bg-panel:#1a2028`，`theme-report` 上报 `THEME_OK` | ✅ |
| ④ | iframe 崩溃（栈溢出）不波及主窗口 | 崩溃后 2s 主框架存活，`hostAlive: true` | ✅ |

**关键发现（实测补充）**：
- iframe cross-origin 隔离使主框架无法读 iframe DOM——这天然强化了边界（插件不能被宿主窥探内部，宿主也不依赖读插件 DOM）。通信**只能**经 postMessage，与 §5 受控 API 契约的设计一致。
- ②的"全 undefined"证明：只要不配 `allow-same-origin` + 不给 iframe 注入 preload，插件从结构上就无法获得任何 Node/Electron 能力。安全不靠约定，靠浏览器原生隔离。

## 8. 决策状态

- **本 spike 推荐**：6b = iframe sandbox，6c = UtilityProcess。
- **门禁**：roadmap M5 要求"安全模型 review 通过"才能开工。本文档即为 review 依据。
- **锁定状态**：✅ **F1 已锁定**（2026-07-29）。PoC 4 项全过，选型结论成立。后续 6b 实现以本 spec 为准——F2（受控 API 契约）可在 §5 基础上细化，F3（加载器）封装单一 `<PluginFrame>` 组件统一签发 `sandbox="allow-scripts"`（绝不加 `allow-same-origin`）。
