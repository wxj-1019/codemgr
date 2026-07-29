# CodeMgr 改进路线图 — 实施计划

> 日期：2026-07-29
> 关联 spec：`docs/superpowers/specs/2026-07-29-codemgr-roadmap-proposals.md`
> 范围：基于已锁定决策（D1 react-mosaic / D2 数组AND / D3 路线A / D4 全做），把 6 个方向排成**有依赖、有里程碑、有验收门禁**的可执行计划。
> 起点：v1.1（当前 main，78 测试通过）。

---

## 0. 锁定决策速查

| 决策 | 选定 | 落地影响 |
|------|------|---------|
| **D1** | `react-mosaic-component`（自由拆分/嵌套） | 方案 1 用 mosaic；`allotment` 仅作 ProcessPanel 内部侧栏可调宽 |
| **D2** | `LabelRule.pattern: string \| string[]`，数组=AND | 方案 2 模型定稿；"vite AND build" 单条迁移 |
| **D3** | 路线 A：按需精确 cwd | 方案 5 不进 `processScan` 热路径；与方案 3 共用 `peb_access` |
| **D4** | 6 个方向全做 | 排入 v1.2 / v1.3 / v2.0 三个版本 |

---

## 1. 版本规划总览

```
v1.1（已完成，当前 main）
   │
   ▼
┌──────────────── v1.2 ────────────────┐    ← 纯前端，零 native 改动
│  ① 标签规则（D2）   ② 可拖拽布局（D1） │
│  依赖：无交叉，可双轨并行             │
└──────────────────────────────────────┘
   │ 里程碑：v1.2 可独立发布
   ▼
┌──────────────── v1.3 ────────────────┐    ← 首次引入"按需 native 通道"
│  ③ 单进程曲线    ④ 环境变量查看       │
│  ⑤ 按需精确 cwd（D3，与④共用peb_access）│
│  依赖：④→⑤（共享 PEB 读取层）         │
└──────────────────────────────────────┘
   │ 里程碑：v1.3 native 能力扩展完成
   ▼
┌──────────────── v2.0 ────────────────┐    ← 架构级扩展
│  ⑥ 插件系统（6a 配置型已在 v1.2 完成）  │
│  依赖：v1.2 的标签引擎 + v1.3 的IPC模式 │
└──────────────────────────────────────┘
```

---

## 2. 依赖关系图

```
        ┌── 方案2 标签规则 (v1.2) ──┐
        │   （纯前端，无前置）       │
        │                            ├──→ 方案6 插件系统 (v2.0)
        └── 方案1 可拖拽布局 (v1.2) ─┘    6a = 方案2 即"配置型插件"
            │   （纯前端，无前置）
            │   软依赖：方案4 之后做（侧栏可拖宽让曲线更舒服）
            ▼
        方案4 单进程曲线 (v1.3)          ← 数据已在手，纯增量
            （软依赖方案1 的可调宽，但可独立）
            ▼
        方案3 环境变量查看 (v1.3)        ← 首个按需 native 通道
            │ 抽出 peb_access.cpp/.h
            ▼
        方案5 精确 cwd (v1.3, D3)        ← 复用方案3 的 peb_access
```

**硬依赖**（必须前置完成）：
- 方案 5 依赖方案 3 的 `peb_access` 基础设施。
- 方案 6b/6c（v2.0 真正的 JS 插件）依赖方案 2（标签引擎作为扩展点原型）+ 方案 3（按需 IPC 模式）。

**软依赖**（建议但不强制）：
- 方案 1 建议在方案 4 之后（侧栏可拖宽提升曲线体验），但两者可独立。
- 方案 4 建议在方案 1 之前（先有数据层再考虑布局），但非必须。

**可并行**：
- v1.2 内：方案 1 与方案 2 完全独立，可双轨并行开发。

---

## 3. 各版本详细排期

### v1.2 — 前端能力扩展（零 native 改动）

> **特性主线**：让用户能自定义标签 + 自由安排面板。无 ABI 重编译负担，可快速迭代。

#### 任务 W1.2-A：方案 2 — 自定义标签规则（D2 数组 AND）

| 步骤 | 内容 | 产出 | 测试 |
|:---:|------|------|------|
| A1 | 写规则引擎 + 默认规则数据 | `labelRules.ts`、`defaultRules.ts` | TDD：各 mode、AND 数组、首匹配顺序、非法正则降级 |
| A2 | 配置 IPC（load/save JSON） | `ipc-types.ts`/`preload.ts`/`main.ts`/`ipc.ts` 各 +1 通道 | 文件读写单测 |
| A3 | 规则 store（合并默认+用户） | `labelRulesStore.ts` | 合并优先级单测 |
| A4 | 改 `processLabels.ts` 委托引擎 | 签名不变，调用点零改 | 现有 `processLabels.test.ts` 全过（语义保真回归） |
| A5 | 规则编辑器 UI | `LabelRuleEditor.tsx`（表格+表单+实时预览） | 人工验收 |
| A6 | 文档 + CHANGELOG | `CHANGELOG.md` v1.2 条目 | — |

**关键回归用例**："`vite build` 必须命中 'build task' 而非 'dev server'"——验证有序首匹配在迁移后仍正确。

#### 任务 W1.2-B：方案 1 — 可拖拽面板布局（D1 react-mosaic）

| 步骤 | 内容 | 产出 | 测试 |
|:---:|------|------|------|
| B1 | 加依赖 `react-mosaic-component` | `app/package.json` | bundle 体积检查 |
| B2 | 布局 store（二叉树 + persist） | `layoutStore.ts`（key `codemgr:layout`） | TDD：applyPreset、setRoot 深度更新、partialize |
| B3 | Panel 包装器（注册+可见性节流） | `<Panel id>` + IntersectionObserver | 可见性暂停轮询单测 |
| B4 | 重写 App.tsx 渲染区 | `<Mosaic renderTile value=.../>` | 人工验收 |
| B5 | ProcessPanel 内部可调宽 | `allotment` SplitPane 包裹表格/侧栏 | 人工验收 |
| B6 | mosaic 主题适配（CSS 变量覆盖） | `index.css` 覆盖层 | 亮/暗主题双验收 |
| B7 | 预设管理（classic/port+perf/dev-focus） | 预设数据 + nav 切换 UI | 预设合法性单测 |
| B8 | 文档 + CHANGELOG | `CHANGELOG.md` | — |

**关键风险点**：B3 多面板并发轮询 → native 同帧尖刺（`processScan` p99=17.7ms 与 perf 叠加）。对策：可见性节流 + 必要时 hook 层错峰。

---

### v1.3 — native 能力扩展（按需通道）

> **特性主线**：首次引入"按需 native 通道"模式（区别于现有全量轮询）。引入 `peb_access` 共享层。

#### 任务 W1.3-A：方案 4 — 单进程 CPU/内存曲线（纯前端，数据已在手）

| 步骤 | 内容 | 产出 | 测试 |
|:---:|------|------|------|
| C1 | store 扩展 `procHistory` | `processPanelStore.ts` +1 字段 + 采点逻辑 | TDD：采点、60点裁剪、退出清理 |
| C2 | 抽 MiniChart 组件 | `MiniChart.tsx`（从 PerfPanel 提炼） | — |
| C3 | sidebar 渲染两图 | `ProcessDetailSidebar.tsx` | 人工验收：盯曲线动 |
| C4 | 文档 + CHANGELOG | — | — |

**注意**：进程轮询 2s → 60 点 = 120s 窗口（非 perf 的 60s），UI 需标注。

#### 任务 W1.3-B：方案 3 — 环境变量查看（首个按需 native 通道）

| 步骤 | 内容 | 产出 | 测试 |
|:---:|------|------|------|
| D1 | 抽 PEB 共享层 | `peb_access.cpp/.h`（OpenForRead + ReadPebProcParams + ReadRemoteUnicodeString） | — |
| D2 | 实现 `ReadProcessEnv` | `process_env.cpp/.h` | native 测试：自身进程含 PATH；System(pid=4) 返 null |
| D3 | 全链路接线（6 处各 1 行） | addon/index/ipc-types/preload/main/ipc | — |
| D4 | sidebar 环境变量分区 | 搜索框 + 键值列表 + 复制 | 人工验收 |
| D5 | 重编译 `pnpm build:electron` | — | AGENTS 避坑 #1 |
| D6 | 文档 + CHANGELOG | — | — |

**关键**：D1 抽出的 `peb_access` 是方案 5 的前置依赖。

#### 任务 W1.3-C：方案 5 — 按需精确 cwd（D3 路线 A，复用 peb_access）

| 步骤 | 内容 | 产出 | 测试 |
|:---:|------|------|------|
| E1 | 实现 `ReadProcessCwd`（复用 peb_access） | `process_cwd.cpp/.h` | native 测试：自身 cwd=process.cwd() |
| E2 | NT→DOS 路径转换（native 侧 QueryDosDevice） | 同上 | NT 前缀剥离单测 |
| E3 | 全链路接线（6 处） | getCwd 通道 | — |
| E4 | 前端 normPath 扩展前缀剥离 | `projectGroup.ts` | 现有 projectGroup 测试 + 新增前缀用例 |
| E5 | 触发逻辑（未分组组展开/选中时按需拉） | store + sidebar | 人工验收：npm run dev 归组正确 |
| E6 | **必跑 `pnpm bench`** 确认热路径零回归 | bench 报告 | p99 < 20ms（未改 processScan，应=基线） |
| E7 | 文档 + CHANGELOG | — | — |

**门禁**：E6 是硬门禁——bench 不过则该任务阻塞，需回查是否误改了 `processScan`。

---

### v2.0 — 插件系统（架构级）

> **特性主线**：把 v1.2/v1.3 沉淀的扩展点（标签引擎、按需 IPC）正式化为插件 SDK。

#### 任务 W2.0-A：方案 6a — 配置型标签插件（已在 v1.2 完成）

无额外工作——方案 2 落地即等于 6a。v2.0 只需把标签规则的存储/合并逻辑文档化为"插件扩展点契约"。

#### 任务 W2.0-B：方案 6b — JS 插件沙箱（需 spike 原型）

| 步骤 | 内容 | 产出 | 状态 |
|:---:|------|------|:---:|
| F1 | 安全模型 spike（iframe sandbox vs Worker+Comlink vs UtilityProcess） | 选型报告 + PoC | ✅ **已锁定**（PoC 4 项全过，见下） |
| F2 | 受控 API 设计（postMessage 契约 + pluginRules 独立层 + manifest IPC） | `pluginProtocol.ts` + `labelRulesStore.pluginRules` + `listPlugins` IPC | ✅ 完成（v2.0） |
| F3 | 插件加载器（`<PluginFrame>` + `<PluginHost>`）+ 生命周期 + 崩溃熔断 | loader + 卸载清理 | ✅ 完成（v2.0，6b 第一步） |
| F4 | 文档：插件开发指南 | `docs/PLUGINS.md` + 可运行示例 | ✅ 完成（v2.0） |

> **6b 第二步（视图嵌入 mosaic）未做**：需改 PanelId 闭合类型 + 4 耦合点（renderTile/createNode/PANEL_TITLES/visibilityStore），单独立项。本次 F2-F4 聚焦标签规则注册（价值最高、风险最低），不动 mosaic。

**门禁**：F1 的安全选型必须先过 review——这是 v2.0 最大的不确定性，不允许边做边定。

> **F1 选型结论（2026-07-29，已锁定）**：桌面调研 + PoC 实证完成，详见 `docs/superpowers/specs/2026-07-29-plugin-sandbox-spike.md`。
> 推荐**分阶段混合**：6b = **iframe sandbox**（`allow-scripts` 不给 `allow-same-origin`，唯一能"既最安全又可贡献视图"，Worker 因无 DOM 无法满足视图需求）；6c = **UtilityProcess**（仅当插件需新 native 能力时，进程级隔离 + 白名单 native）。
> Worker 降级为标签规则正则匹配 offload 的纯逻辑执行环境，不作为主沙箱。
> **PoC 4 项全过**（Electron 43 实测）：① iframe 内 React 渲染快照 ② `require`/`codemgr`/`process` 全 undefined（红线结构保证）③ CSS 变量主题 postMessage 同步 ④ iframe 崩溃不波及主窗口。F1 门禁通过，可进入 F2-F4。

#### 任务 W2.0-C：方案 6c — 插件贡献数据源（远期）

依赖 6b 稳定后，开放受控的 native 能力白名单。**不在本计划排期内**，作为 v2.0+ 探索项。

---

## 4. 里程碑与验收门禁

| 里程碑 | 内容 | 门禁（必须全绿） |
|--------|------|-----------------|
| **M1: v1.2-rc** | 方案 1+2 完成 | 78 基线测试 + 新增 store/引擎测试全过；亮/暗主题双验收；bundle 体积无异常增长 |
| **M2: v1.2 release** | 打 tag `v1.2` | M1 绿 + CHANGELOG 更新 + 人工回归三大面板 |
| **M3: v1.3-rc** | 方案 3+4+5 完成 | 全测试过；**`pnpm bench` p99<20ms**；native 11→13 测试（+env +cwd） |
| **M4: v1.3 release** | 打 tag `v1.3` | M3 绿 + CHANGELOG + 真实场景验证（npm run dev 归组、env 读取） |
| **M5: v2.0 安全 spike** | 方案 6b 选型 | 安全模型 review 通过（红线：插件不碰 native/ipcRenderer） |
| **M6: v2.0 release** | 方案 6 插件 | M5 绿 + 插件 SDK 文档 + 至少 1 个示例插件 |

**通用门禁**（每个 PR）：
- Conventional Commits + 分支规范。
- pre-commit hook 增量测试过。
- 改 native 必跑 `pnpm build:electron` 重编译（避坑 #1）。
- 改 `processScan` 必跑 `pnpm bench`。

---

## 5. 风险登记册（跨版本）

| ID | 风险 | 版本 | 等级 | 对策 | 触发指标 |
|----|------|:---:|:---:|------|---------|
| R1 | react-mosaic 主题冲突 | v1.2 | 中 | 集中 CSS 变量覆盖层 | 视觉 review 不通过 |
| R2 | 多面板并发轮询致 native 尖刺 | v1.2 | 中 | 可见性节流 + hook 错峰 | perf 面板卡顿 |
| R3 | 用户慢正则拖垮渲染 | v1.2 | 中 | 正则 try/catch + 长度上限 | 编辑器实时校验 |
| R4 | PEB 偏移跨 Windows 版本不稳 | v1.3 | 中 | 优先 NtQuery class；偏移作 fallback | env/cwd 读取率下降 |
| R5 | 误改 processScan 破红线 | v1.3 | 高 | E6 bench 硬门禁 | bench 失败 |
| R6 | NT 路径转换不全致分组错乱 | v1.3 | 中 | native 全量建表 + 失败标记 | 分组抖动 |
| R7 | 插件沙箱逃逸 | v2.0 | 高 | 受控 API + review 门禁 | 安全 review |
| R8 | 插件 SDK 设计反复 | v2.0 | 中 | 先让方案 2 沉淀 6-12 月 | API 频繁 breaking |

---

## 6. 并行策略建议

- **v1.2 可双轨**：方案 1（布局）与方案 2（标签）零交叉，建议两人或两分支并行，最后集成。
- **v1.3 串行关键路径**：方案 3（peb_access）→ 方案 5（复用）。方案 4 可与 3 并行（纯前端）。
- **v2.0 前置 spike**：方案 6b 的安全选型（F1）应在 v1.3 后期就启动调研，不等 v2.0 正式开工。

---

## 7. 与现有规范的契约

| 规范 | 本计划如何遵守 |
|------|:---:|
| 渲染层不直接 require native（红线） | ✅ 方案 3/5 走完整 6 处 IPC 接线 |
| 新 native collector 单文件单职责 | ✅ process_env.cpp / process_cwd.cpp / peb_access.cpp 各独立 |
| 性能改动跑 bench | ✅ 方案 5 E6 硬门禁；方案 1 关注并发尖刺 |
| Conventional Commits + feat/fix 分支 | ✅ 每任务可独立成分支 |
| 新代码有测试 | ✅ 每任务列出 TDD/人工验收 |
| 更新 CHANGELOG | ✅ 每版本里程碑含 CHANGELOG 条目 |
| kill 路径复用 IsProtected | N/A（本计划无新 kill 路径） |

---

## 8. 立即可启动的第一步

按依赖与收益，**建议立即启动 v1.2 的两个任务**（可并行）：

- **W1.2-A 步骤 A1**：写标签规则引擎 + 默认规则数据（TDD）。这是整个路线图的"第一块砖"——纯前端、零依赖、直接为方案 6 打基础。
- **W1.2-B 步骤 B1-B2**：加 react-mosaic 依赖 + 建布局 store。验证 mosaic 与现有主题/轮询的兼容性，尽早暴露 R1/R2 风险。

需要我开始实施其中任一步骤时，告诉我即可（建议从 A1 开始，风险最低）。

---

## 9. 实施状态更新（2026-07-29 追加）

> 本节追加实际落地情况，修正前面章节"待办"的表述。代码是唯一事实来源，本节据 CHANGELOG/git log 同步。

### v1.2（方案 1+2）
- ✅ **方案 2（标签规则）** 已完成（commit `84f46df`）：数据驱动引擎 + 编辑器 + localStorage 持久化。spec 的「导入导出」当时**未做**，留到 v1.4。
- ✅ **方案 1（react-mosaic 全局布局）** 已完成（v1.7）：`react-mosaic-component@^6` 二叉树布局替换 Tab，三大面板可自由拆分/嵌套/拖拽/关闭；`layoutStore` 持久化布局树 + 3 预设（classic/port-perf/dev-focus）；面板可见性轮询节流（IntersectionObserver + visibilitychange，对策 R2）。v1.4 的 allotment 侧栏可拖宽作为 ProcessPanel 内部分栏保留（与外层 mosaic 正交）。

### v1.3（方案 3+4+5）
- ✅ **方案 3（环境变量查看）** 已完成（commit `49255ff`）：`readProcessEnv` PEB 行走 + 详情侧栏「加载环境变量」。
- ✅ **方案 4（单进程曲线）** 已完成（commit `ebb5a01`）：`procHistory` + `MiniChart` CPU/内存双曲线。
- ✅ **方案 5（按需精确 cwd，路线 A）** 已完成（commit `f02124c`）：`readProcessCwd` + 详情侧栏「读取精确工作目录」+ NT 前缀剥离。精确值存组件 local state，**未接入项目分组**（分组仍以启发式 cwd 为键，CHANGELOG 明确为设计决策）。
  - ✅ **方案 5 余项（精确 cwd 接入项目分组）** 已完成（v1.9）：旁路缓存 `preciseCwdByPid` 接入分组键（优先精确值、缺失回退启发式），展开未分组组时分批按需拉取（限流防尖刺），缓存冻结防抖动，侧栏复用缓存。修正 `npm run dev` 等无绝对路径命令行 dev server 的误归未分组。

### v1.4（体验增量，非原 roadmap 列项）
v1.4 是 v1.3 完成后的低风险体验补强，三个独立特性：
- ✅ **标签规则导入导出**：补齐 spec §2.3.4 设计但 v1.2 未做的导入导出。受控文件 IO 通道（main 封装 dialog+fs），为 v2.0 插件系统预演。
- ✅ **进程行右键菜单**：ContextMenu 组件，结束/结束树/复制命令行/复制 PID。
- ✅ **详情侧栏可拖宽**：allotment 分栏，比例持久化（方案 1 的最小子集，非全局 mosaic）。

### 待办（v2.0）
- 方案 6（插件系统）：依赖安全沙箱选型 spike（F1）。

> 方案 1（react-mosaic 全局多面板布局）已于 v1.7 完成。方案 5 余项（精确 cwd 接入项目分组）已于 v1.9 完成。两者从待办移除。
