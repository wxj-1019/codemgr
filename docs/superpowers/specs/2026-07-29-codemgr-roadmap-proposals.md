# CodeMgr 改进方案完善稿

> 日期：2026-07-29
> 范围：基于 v1.1 现状，把 6 个"潜在改进方向"展开为**可落地、可评审、可排期**的详细方案。
> 文档定位：每个方向都是一个**独立的可实施 spec**，含背景、设计、实现步骤、代码草图、测试策略、风险与依赖。
> 配套：阅读前建议先读 `AGENTS.md` 与 `docs/architecture.md`，熟悉三层架构与红线边界。

---

## 总览（先看这个）

> 决策 D4（2026-07-29 锁定）：**6 个方向全部纳入**。版本排期与依赖关系见配套 plan：`docs/superpowers/plans/2026-07-29-codemgr-roadmap-plan.md`。

| # | 方向 | 优先级 | 工作量 | 是否动 native | 是否破红线 | 目标版本 | 决策 |
|---|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | 可拖拽面板布局 | 高 | 大 | 否 | 否 | v1.2 | D1=react-mosaic |
| 2 | 自定义命令行标签规则 | 高 | 中 | 否 | 否 | v1.2 | D2=数组AND |
| 3 | 进程环境变量查看 | 中 | 中 | **是** | 否 | v1.3 | — |
| 4 | 单进程 CPU/内存历史曲线 | 中 | 中 | 否 | 否 | v1.3 | — |
| 5 | 精确 cwd 读取 | 中 | 中 | **是** | 按需通道→无红线✅ | v1.3 | D3=路线A |
| 6 | 插件系统 | 低 | 特大 | 部分 | 否 | v2.0 | — |

**推荐的实施顺序**：`2 → 1 → 4 → 3 → 5 → 6`

理由：
- **2**（标签规则）纯前端、收益高、风险低，先做能立刻提升可用性，且为后续插件系统（6）打基础（规则即最小插件）。
- **1**（布局）工作量最大但价值高，且不依赖其他方向，可与 2 并行。
- **4**（单进程曲线）数据已在手（`cpuMap` + `workingSetBytes`），只是需要历史化，纯增量。
- **3**（环境变量）首次引入"按需 native 通道"，是 5、6 的技术预演。
- **5**（精确 cwd）有性能红线风险，做前必须过 benchmark，可与 3 共用 PEB 读取代码。
- **6**（插件）是 v2.0 架构级目标，依赖 2、3 的接口抽象沉淀。

---

## 方案 1：可拖拽面板布局

### 1.1 背景与问题

当前 `App.tsx` 的布局是**写死的 Tab 切换**——三个面板（Port Radar / Process / Perf）同一时刻只挂载一个：

```tsx
<div className="flex h-screen flex-col">
  <nav>...tab 切换...</nav>
  <div className="flex-1 overflow-hidden">
    {active === 'port' && <PortRadar />}
    {active === 'process' && <ProcessPanel />}
    {active === 'perf' && <PerfPanel />}
  </div>
</div>
```

痛点：
1. **开发者痛点场景**：跑 dev server 时想同时盯着"端口占用 + dev server 的 CPU/内存"——现在必须来回切 Tab。
2. **ProcessPanel 内部已有固定分栏**（表格 + 320px 侧栏），侧栏宽度不可调，小屏被挤、大屏浪费。
3. **PerfPanel 有 4 个子 Tab**（CPU/Mem/Disk/Net），同样一次只能看一个。

### 1.2 目标

- 让用户能**自由拆分/合并面板**：上下分、左右分、嵌套分。
- 提供**预设布局**（"单 Tab 经典"、"双栏：端口+性能"、"开发聚焦：进程+性能"），一键切换。
- 分割条可**拖拽改变比例**，比例**持久化**（复用现有 Zustand `persist` 模式）。
- 不破坏现有各面板的"自撑高 + 轮询 hook 仅活跃时运行"的设计。

### 1.3 设计

#### 1.3.1 技术选型对比（关键决策）

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. `react-mosaic-component`** | 原生支持窗口嵌套拆分、拖拽、最小化；API 声明式；活跃维护 | 体积 ~30KB；视觉风格需覆盖 | ⭐ **推荐** |
| B. `allotment`（VS Code 同款） | 分割条体验最好、VS Code 验证过 | 只做分栏不做自由布局；嵌套需自己组合 | 备选（若只要分栏） |
| C. `react-grid-layout` | 自由网格拖拽 | 偏"仪表盘卡片"，与"面板"心智不符；移动端包袱 | 不推荐 |
| D. 纯手写 split pane | 零依赖、完全可控 | 拖拽/嵌套/触摸/无障碍全要自己写，工作量巨大 | 不推荐 |

**选定 `react-mosaic-component`**（决策 D1，2026-07-29 锁定）：它把"面板树"建模成一棵二叉树（`split percentage + 左右子节点`），与我们要持久化的结构天然吻合，且支持自由拆分/嵌套/最小化。`allotment` 降级为 ProcessPanel 内部"表格+侧栏"的可调宽分栏的轻量补充（见 §1.3.4）。

#### 1.3.2 布局状态模型

新增 `layoutStore.ts`，镜像 `processPanelStore` 的 persist 模式：

```ts
// app/src/store/layoutStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PanelId = 'port' | 'process' | 'perf';
// mosaic 的树节点（与 react-mosaic 的 MosaicNode 对应）
export type LayoutNode =
  | PanelId                         // 叶子：一个面板
  | { direction: 'row' | 'column'; splitPercentage: number; first: LayoutNode; second: LayoutNode };

interface LayoutState {
  root: LayoutNode;                 // 当前布局树
  preset: string;                   // 当前预设名
  setRoot: (n: LayoutNode) => void;
  applyPreset: (name: PresetName) => void;
}
```

预设（`preset` 固定几种，用户改动后 `preset` 置为 `'custom'`）：

```ts
const PRESETS: Record<PresetName, LayoutNode> = {
  classic: 'port',                                   // 单面板（兼容现状）
  'port+perf': { direction:'row', splitPercentage:50, first:'port', second:'perf' },
  'dev-focus': { direction:'row', splitPercentage:60, first:'process', second:'perf' },
};
```

#### 1.3.3 与轮询 hook 的协作（重要）

现状：面板卸载即停止轮询（hook cleanup 清 interval）。多面板同时挂载后，**多个 hook 会并发跑**——需评估：
- Port(3s) + Process(2s) + Perf(1s) 同时跑，每秒最多触发 1 次 perf + 偶发 process/port。
- native 侧各 collector 独立、无锁竞争（已验证）。但 `processScan` p99=17.7ms，若与 `perfCounters`(p99~3ms) 同帧触发，主线程瞬时阻塞需观察。
- **对策**：hook 保持不变，但加一个"可见性节流"——面板被 mosaic 折叠/最小化时，通过 `IntersectionObserver` 检测可见性，不可见时暂停轮询（已有 `busyRef`/`stoppedRef` 模式可扩展）。

#### 1.3.4 ProcessPanel 内部分栏

`ProcessPanel.tsx:159` 现有的 `<div className="flex flex-1 overflow-hidden">`（表格 + 侧栏）用 `allotment` 的 `<SplitPane>` 包裹即可独立于全局 mosaic，提供"侧栏可拖宽"。这是最小可见收益。

### 1.4 实现步骤

1. **加依赖**：`pnpm --filter codemgr-app add react-mosaic-component`（或 allotment）。
2. **建 store**：`layoutStore.ts` + persist（key `codemgr:layout`）。
3. **抽 Panel 包装器**：把 PortRadar/Process/Perf 各包一层 `<Panel id>`，负责注册到 mosaic 并暴露"替换为/分屏"右键菜单。
4. **重写 `App.tsx` 的渲染区**：用 `<Mosaic renderTile={(id) => PANELS[id]} value={root} onChange={setRoot} />` 替换条件渲染；保留顶部 `<nav>` 作为预设切换 + 主题按钮。
5. **ProcessPanel 内部**：表格/侧栏用 allotment SplitPane 包裹。
6. **可见性节流**：给 Panel 包装器加 IntersectionObserver，不可见时调用各 store 的 `reset()`/暂停。
7. **主题适配**：react-mosaic 的默认样式需覆盖为 CSS 变量（`--bg-panel`/`--border`/`--text-muted`），避免破坏亮色主题。

### 1.5 测试策略

- **纯逻辑（TDD）**：`layoutStore` 的 `applyPreset`、`setRoot` 深度更新、`persist` partialize —— Vitest。
- **预设合法性**：校验每个 PRESETS 节点引用的 PanelId 都存在。
- **UI（人工验收）**：拖拽分屏、嵌套拆分、刷新后布局恢复、折叠面板轮询停止、亮/暗主题下分割条样式。
- **回归**：跑全部 78 个现有测试，确保 store/hook 改动未破坏。

### 1.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| react-mosaic 的视觉与 CodeMgr 主题冲突 | 中 | 集中写一层 CSS 变量覆盖，参照 v1.1 主题治理经验 |
| 多面板并发轮询导致 native 同帧尖刺 | 中 | 加可见性节流；必要时在 hook 层做请求错峰 |
| 包体积增长 | 低 | mosaic ~30KB gzip，可接受；监控 bundle |
| 既有 Tab 用户的肌肉记忆 | 低 | 保留"经典"预设 = 单面板，默认行为不变 |

### 1.7 依赖与前置

- 无 native 改动。
- 建议在方案 4（单进程曲线）之后做，因为侧栏可拖宽后曲线展示更舒服。

---

## 方案 2：自定义命令行标签规则

### 2.1 背景与问题

当前 `app/src/lib/processLabels.ts` 是**硬编码模式匹配**，核心逻辑：

```ts
export function labelForProcess(name, cmdline): ProcessLabel | null {
  const lower = (name + ' ' + cmdline).toLowerCase();
  if (name.toLowerCase().includes('postgres') || lower.includes('postgres')) return { label:'PostgreSQL', kind:'db' };
  // ... 一连串 if/return，顺序敏感 ...
  if (lower.includes('vite')) return { label:'dev server', kind:'dev' };
  // ...
}
```

痛点：
1. **不可配置**：用户的内部框架（如自研 RPC、公司脚手架）永远打不上标签。
2. **匹配能力弱**：只有 `String.includes` 子串匹配，无正则、无"AND 多条件"标准化。
3. **顺序脆弱**：注释明确写"Build patterns 必须在 generic vite 之前"——加规则极易踩坑。
4. **kind 是封闭枚举**（`'dev'|'test'|'build'|'container'|'db'|'system'`），用户加不了新类别。
5. 两个调用点（`ProcessTable.tsx`、`ProjectGroupView.tsx`）写死 `(name, cmdline)`，未来想用 cwd 辅助判断要改两处。

### 2.2 目标

- 用户能**增删改查**标签规则，规则**持久化**（落盘到用户配置目录）。
- 规则引擎保持**确定性的"有序首匹配"**语义（兼容现有行为）。
- 规则支持：目标字段（name/cmdline/both）、多关键字 AND、可选正则、自定义 label 与颜色。
- **内置默认规则**与用户规则分离：升级 CodeMgr 时默认规则可更新而不覆盖用户规则。
- 零性能回归（标签计算在渲染热路径，每个可见行都跑）。

### 2.3 设计

#### 2.3.1 规则数据模型

```ts
// app/src/lib/labelRules.ts
export type MatchField = 'name' | 'cmdline' | 'both';
export type MatchMode = 'contains' | 'equals' | 'startsWith' | 'regex';

export interface LabelRule {
  id: string;                  // 稳定 ID（uuid），便于增删
  label: string;               // 显示文本，如 "dev server"
  kind: string;                // 自定义类别（字符串，不再封闭枚举）
  color?: string;              // 可选 hex，覆盖该 kind 默认色
  field: MatchField;           // 在哪个字段上匹配
  mode: MatchMode;
  pattern: string;             // contains 下是子串；regex 下是正则源码
  caseSensitive?: boolean;     // 默认 false（兼容现状）
  enabled: boolean;            // 可禁用单条
}
```

#### 2.3.2 匹配引擎（保持有序首匹配）

```ts
export function matchRules(
  rules: LabelRule[],
  name: string,
  cmdline: string,
): { label: string; kind: string; color?: string } | null {
  for (const r of rules) {
    if (!r.enabled) continue;
    const hay = haystack(r.field, name, cmdline);     // both → name+' '+cmdline
    const hit = testPattern(r.mode, r.pattern, hay, r.caseSensitive ?? false);
    if (hit) return { label: r.label, kind: r.kind, color: r.color };
  }
  return null;
}
```

- **顺序 = 数组顺序**，首匹配返回，完全复刻现状语义。
- `testPattern` 对 `regex` 模式用 `new RegExp(pattern)` 并 try/catch（非法正则降级为不匹配 + 控制台告警）。
- **性能**：规则数预期 < 100，每行 O(规则数)；正则模式预编译缓存（`WeakMap<rule, RegExp>`）。

#### 2.3.3 默认规则 = 现有硬编码的 1:1 迁移

把 `processLabels.ts` 里每条 `if` 翻译成一条 `LabelRule`。例如：
- `if (lower.includes('vite') && lower.includes('build')) → 'build task'`
  → `{ field:'both', mode:'contains', pattern:'vite' }` **AND** 一条 `pattern:'build'`？
- 注意：现有"AND 双子串"无法用单条 `LabelRule` 表达。

> **采用数组 AND**（决策 D2，2026-07-29 锁定）：`pattern: string | string[]`，数组语义 = 全部命中才算匹配。现有 "vite AND build" → `{ field:'both', mode:'contains', pattern:['vite','build'] }` 单条规则即可 1:1 迁移。

#### 2.3.4 配置存储

新增 IPC 通道（复用现有 main→file 模式）：

```ts
// ipc-types.ts
export const IPC = {
  // ...existing...
  LABEL_RULES_LOAD: 'config:loadLabelRules',
  LABEL_RULES_SAVE: 'config:saveLabelRules',
} as const;
```

配置文件位置：`app.getPath('userData') + '/label-rules.json'`（Electron 标准 userData 目录，跨版本持久）。

存储结构（**默认规则与用户规则分离**，避免升级覆盖）：

```json
{
  "version": 1,
  "userRules": [ /* 用户自定义 */ ],
  "disabledDefaults": ["rule-uuid-..."],   // 用户禁用了哪些默认规则
  "overrides": { "rule-uuid-...": { "label": "我的别名" } }  // 可选：覆盖默认规则的某些字段
}
```

合并顺序：`默认规则（去掉 disabledDefaults，应用 overrides）→ 追加 userRules`。**用户规则永远在默认之后**（让默认的高优先规则如 'vite build' 仍先生效）。

#### 2.3.5 渲染层集成

- 新增 `labelRulesStore.ts`：持有合并后的 `rules: LabelRule[]`，启动时通过 IPC load。
- `labelForProcess` 改为读取 store 的 rules 调 `matchRules`（保留同名签名 `(name, cmdline) => ProcessLabel | null`，调用点零改动）。
- 设置入口：在 `App.tsx` 顶部 nav 加一个"⚙️ 标签规则"按钮，弹出模态/侧栏编辑器（增删改、启用/禁用、实时预览——输入 name+cmdline 即时显示命中结果）。

### 2.4 实现步骤

1. **写引擎 + 默认规则数据**（TDD）：`labelRules.ts` + `defaultRules.ts`（把现有 if 平移）+ `labelRules.test.ts`（含"vite build 必须先于 vite"的顺序回归用例）。
2. **native/main 配置读写**：`main.ts` 加 2 个 `ipcMain.handle`（load/save JSON），`preload.ts` + `ipc.ts` + `ipc-types.ts` 三处加方法。
3. **store**：`labelRulesStore.ts`，load 后合并默认+用户。
4. **改 `processLabels.ts`**：内部改为委托 `matchRules`，签名不变（调用点零改）。
5. **设置 UI**：`LabelRuleEditor.tsx` 模态，含表格 + 新增表单 + 预览框。
6. **迁移现有测试**：`processLabels.test.ts` 改为针对"默认规则集"断言（语义不变）。

### 2.5 测试策略

- **纯逻辑 TDD**（核心）：
  - 引擎：各 mode（contains/equals/startsWith/regex）、AND 数组、大小写、enabled 过滤、首匹配顺序、非法正则降级。
  - 合并：默认+用户+disabled+overrides 的优先级。
- **回归**：现有 `processLabels.test.ts` 全部用例在"默认规则集"下必须仍通过（保语义）。
- **UI 人工验收**：增删改、预览命中、刷新后规则还在、禁用默认规则生效。

### 2.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| 用户写恶意/慢正则导致渲染卡顿 | 中 | 正则超时（match 包 try/catch + 可选长度上限）；编辑器实时校验 |
| 默认规则升级与用户 override 冲突 | 低 | 用稳定 uuid 而非数组下标做关联；版本号字段预留迁移 |
| 配置文件损坏 | 低 | load 时 try/catch JSON.parse，失败回退默认规则并备份坏文件 |

### 2.7 与其他方向的协同

- **方案 6（插件）**：标签规则本质是"最小插件"。规则引擎设计成插件可注册的接口，v2.0 插件能 `registerLabelRules([...])`。
- **方案 5（精确 cwd）**：未来若想让规则基于 cwd 匹配（如"凡 cwd 在 D:\work 下的标 'work' "），`MatchField` 加 `'cwd'` 即可——现在预留字段。

---

## 方案 3：进程环境变量查看

### 3.1 背景与问题

开发者常需要看一个进程的环境变量：`NODE_ENV` 是 production 吗？`PORT` 设了吗？`PATH` 里有没有冲突？目前 CodeMgr 完全没有这个能力，只能靠 Process Explorer 或复制 PID 去别处查。

### 3.2 目标

- 在 **ProcessDetailSidebar** 增加"环境变量"分区：搜索框 + 键值列表（可复制）。
- **按需获取**（点开/选中时才拉取），绝不进 `processScan` 热路径。
- 对**无权限读取的进程**（系统/PPL/其他用户的进程）优雅降级，显示"无权限读取"。

### 3.3 设计

#### 3.3.1 native 层：PEB 环境块读取

环境变量存在目标进程 PEB → `RTL_USER_PROCESS_PARAMETERS.Environment`（一个指针）+ `EnvironmentSize`。读取链路（与现有 cmdline class 60 同源，但需读远端内存）：

```cpp
// codemgr-native/src/process_env.cpp（新文件）
// 1. 解析 NtReadVirtualMemory（与现有 NtQIP 同样的动态解析模式）
typedef NTSTATUS (NTAPI *pNtReadVirtualMemory_t)(
    HANDLE, PVOID, PVOID, SIZE_T, PSIZE_T);
static pNtReadVirtualMemory_t NtRVM = nullptr;
//   GetProcAddress(ntdll, "NtReadVirtualMemory")

// 2. 读环境变量
bool ReadProcessEnv(ULONG pid,
                    std::vector<std::pair<std::string,std::string>>& out,
                    std::string& err) {
  HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
  if (!h) { err = "ACCESS_DENIED"; return false; }   // 与 cmdline 降级一致

  // 2a. NtQueryInformationProcess(ProcessBasicInformation=0) → PebBaseAddress
  PROCESS_BASIC_INFORMATION pbi{}; ULONG ret=0;
  NtQIP(h, 0, &pbi, sizeof(pbi), &ret);
  if (!pbi.PebBaseAddress) { CloseHandle(h); err="no peb"; return false; }

  // 2b. 读 PEB.ProcessParameters 指针（x64 偏移 0x20）
  PVOID procParams = nullptr;
  NtRVM(h, (PCHAR)pbi.PebBaseAddress + 0x20, &procParams, sizeof(procParams), nullptr);

  // 2c. 读 RTL_USER_PROCESS_PARAMETERS.Environment(0x80) + EnvironmentSize(0x3F0, x64)
  PVOID envPtr=nullptr; ULONG envSize=0;
  NtRVM(h, (PCHAR)procParams + 0x80, &envPtr, sizeof(envPtr), nullptr);
  NtRVM(h, (PCHAR)procParams + 0x3F0, &envSize, sizeof(envSize), nullptr);
  if (!envPtr || !envSize) { CloseHandle(h); err="no env"; return false; }

  // 2d. 读整个环境块（UTF-16，KEY=Value\0 ... \0\0）
  std::vector<wchar_t> buf(envSize / 2);
  NtRVM(h, envPtr, buf.data(), envSize, nullptr);
  CloseHandle(h);

  // 2e. 按 \0 切分，每个再按第一个 '=' 切 key/value，UTF-16→UTF-8
  ...
  return true;
}
```

> ⚠️ 偏移值（0x20/0x80/0x3F0）需在实现时用 WinDbg/文档核对，跨 Windows 版本可能微变。更稳健的做法是用 `NtQueryInformationProcess` 能查到的字段尽量用 class 查询，PEB 偏移只作补充。

#### 3.3.2 与热路径隔离（红线）

- 这是**独立函数 + 独立 IPC 通道**，**不进 `processScan`**。
- 与方案 5 共用 PEB 读取基础设施，但调用方式不同：5（cwd）若进热路径有性能红线问题（见 §5），3（env）天然按需、无红线约束。

#### 3.3.3 全链路接线（6 处，每处 1 行）

| 层 | 文件 | 改动 |
|----|------|------|
| native 注册 | `addon.cpp` | `exports.Set("getProcessEnv", ...GetProcessEnv)` |
| native 类型 | `index.ts` | `NativeBindings.getProcessEnv(pid): Record<string,string>\|null` |
| IPC 常量+类型 | `ipc-types.ts` | `FETCH_PROCESS_ENV:'proc:fetchEnv'` + 返回类型 + `ExposedApi` |
| main | `main.ts` | `ipcMain.handle(FETCH_PROCESS_ENV, (_e,pid)=> native.getProcessEnv(pid))` 失败返 null |
| preload | `preload.ts` | `fetchProcessEnv:(pid)=>invoke(FETCH_PROCESS_ENV, pid)` |
| renderer | `ipc.ts` | `async fetchProcessEnv(pid){ return window.codemgr.fetchProcessEnv(pid); }` |

#### 3.3.4 渲染层

- `ProcessDetailSidebar.tsx` 在现有 `<dl>` 下方加"环境变量"折叠区。
- 选中进程变化时，用 `useEffect` + 防抖拉取（避免快速切换连发请求）。
- 拉取期间显示 spinner；null 时显示"无权限读取"；空对象显示"无环境变量"。
- 列表带搜索框（前端过滤）+ 每行复制按钮（复用 cmdline 的 copy 模式）。

### 3.4 实现步骤

1. native：新建 `process_env.cpp/.h`，实现 `ReadProcessEnv` + `GetProcessEnv`（Napi marshal 成 Object map）。
2. 注册：`addon.cpp` + `index.ts`。
3. IPC 三件套：`ipc-types.ts` / `preload.ts` / `main.ts` / `ipc.ts`。
4. native 测试：`tests/env.test.ts`——读自身进程（`process.pid`）的 env，断言含 `PATH`/`NODE_ENV` 之类已知键。
5. UI：sidebar 加折叠区 + 搜索 + 复制。
6. 重编译：`pnpm build:electron`（AGENTS 避坑 #1）。

### 3.5 测试策略

- **native 正确性**：读自身进程 env（必有 PATH）；读不存在的 pid 返回 null；读受保护进程（pid=4 System）返回 null 不崩。
- **性能**：单次 `getProcessEnv` 应 < 5ms（无红线，但记录基线）。
- **UI 人工验收**：切换选中进程、搜索过滤、复制、无权限提示、刷新后重拉。

### 3.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| PEB 偏移跨版本不稳 | 中 | 优先用 NtQuery class；偏移作 fallback；CI 跑多版本（如有条件） |
| 读到极大 env 块拖慢 | 低 | 限制 envSize 上限（如 1MB），超限截断 |
| 用户误以为能看任意进程 env | 低 | UI 明确"无权限"状态，不静默空 |

---

## 方案 4：单进程 CPU/内存历史曲线

### 4.1 背景与问题

`ProcessDetailSidebar` 目前只显示**瞬时值**（内存、累计 CPU 时间），甚至没用到 `cpuMap[pid]` 的实时 CPU%。开发者想看"这个 dev server 的 CPU 是不是在飙、内存是不是在泄漏"——没有时间维度。

### 4.2 目标

- 选中单个进程时，侧栏显示该进程的 **CPU% 曲线**和**内存曲线**（最近 ~120s）。
- 数据复用现有轮询（`fetchCpu` 每 2s + `fetchProcesses` 的 `workingSetBytes`），**不加新 IPC、不动 native**。
- 进程退出后曲线清空；切换选中进程时曲线切换。

### 4.3 设计

#### 4.3.1 数据来源（已在手）

- CPU%：`useProcessPanel` 每 2s 调 `fetchCpu()` → `setCpuMap(CpuUsage[])`，`cpuMap[pid]` 即时 CPU%。
- 内存：`fetchProcesses()` 返回的 `ProcessInfo.workingSetBytes`（每 2s 一次快照）。
- **注意**：进程轮询是 2s 一次，所以 60 点 = 120s 窗口（不是 perf 的 60s）。文档里要说清。

#### 4.3.2 store 扩展

在 `processPanelStore` 增加（**不 persist**，运行时态）：

```ts
interface ProcHistoryPoint { t: number; cpu: number; mem: number; }  // mem=bytes

interface ProcessPanelState {
  // ...existing...
  procHistory: Record<number, ProcHistoryPoint[]>;   // pid -> 滚动窗口
}
const PROC_HIST_LEN = 60;

// 在 setCpuMap 里同时采一点（CPU 已到，内存从当前 processes 取）
setCpuMap: (c) => set((s) => {
  const now = Date.now();
  const memByPid = new Map(s.processes.map(p => [p.pid, p.workingSetBytes]));
  const next = { ...s.procHistory };
  for (const x of c) {
    const arr = [...(next[x.pid] ?? []), { t: now, cpu: x.cpuPercent, mem: memByPid.get(x.pid) ?? 0 }];
    if (arr.length > PROC_HIST_LEN) arr.shift();
    next[x.pid] = arr;
  }
  return { cpuMap: { ...s.cpuMap, ...Object.fromEntries(c.map(x=>[x.pid,x.cpuPercent])) }, procHistory: next };
}),
```

- 在现有 `setProcesses` 的 stale 清理里，**同步清掉 `procHistory` 中已退出 pid 的 key**（与 `cpuMap` 同样的 `pidSet` 过滤模式）。

#### 4.3.3 渲染（复用 PerfPanel 的 Recharts 模式）

`ProcessDetailSidebar` 在 header 与 `<dl>` 之间插入两个小图：

```tsx
{hist && hist.length > 1 && (
  <>
    <MiniChart data={hist} dataKey="cpu" color="#2dd4bf" unit="%" domain={[0,100]} />
    <MiniChart data={hist} dataKey="mem" color="#a78bfa" formatter={formatBytes} />
  </>
)}
```

`MiniChart` = `PerfPanel` 里 `AreaChart` 的抽组件版（80px 高、无 X 轴 label、tooltip 复用）。

#### 4.3.4 时间戳来源

`CpuUsage` 不带 timestamp（perf 数据带）。在 `setCpuMap` 里用客户端 `Date.now()` 打戳——注意这会让曲线时间轴是"客户端钟"，与 perf 面板的"native 钟"略有差异，但对单进程趋势无影响。

### 4.4 实现步骤

1. store：加 `procHistory` + 在 `setCpuMap` 采点 + 在 `setProcesses` 清理。
2. 抽 `MiniChart` 组件（从 PerfPanel 的 CPU/Mem 图提炼）。
3. sidebar：读 `procHistory[selectedPid]`，渲染两图 + 当前 CPU%/内存数值行。
4. store 测试：采点、滚动裁剪、退出清理。
5. （可选）侧栏宽度可拖（依赖方案 1 的分栏，但可独立用 allotment 做）。

### 4.5 测试策略

- **store TDD**：连续两次 `setCpuMap` 产生 2 点；超过 60 点裁剪；`setProcesses` 移除某 pid 后 `procHistory` 该 key 被删。
- **UI 人工验收**：选中 dev server，盯 1 分钟看 CPU/内存曲线动；切进程曲线切换；kill 进程后曲线清空。

### 4.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| `procHistory` 对象随 pid 数增长占内存 | 低 | 已随 setProcesses 清理；窗口固定 60 点 |
| Recharts 在侧栏小尺寸下 tooltip 错位 | 低 | 复用 PerfPanel 已验证的配置 |
| 亮色主题下图表色不自适应 | 低 | 已知遗留（PerfPanel 同样问题），方案 1 主题治理时一并处理 |

---

## 方案 5：精确 cwd 读取

### 5.1 背景与问题

当前 cwd 是**命令行启发式**（`ExtractCwdFromCmdline`）：从 cmdline 找第一个 `X:\` 路径取其目录。代价零、性能好（p99=17.7ms），但**精度差**：
- `node server.js`、`npm run dev` → cmdline 无绝对路径 → cwd 空 → 落入"未分组"。
- 第一个驱动器路径可能是脚本路径而非 cwd（取错目录）。

理想方案是读 PEB `ProcessParameters.CurrentDirectory`（真实 cwd，96% 进程可读），但 `process_collector.cpp` 注释已量化代价：**每进程 +1 次 NtQIP + 3 次 NtReadVirtualMemory，~360 进程下单次 p99 从 16ms 涨到 21ms，超 20ms 红线**。

### 5.2 目标

- 提升 cwd 精度，**让 `npm run dev` 这类常见场景能正确分组**。
- **不破坏 20ms 红线**（`bench/process.bench.ts` Go/No-Go）。
- 与方案 3 共用 PEB 读取代码。

### 5.3 设计（关键：如何不破红线）

核心矛盾：全量 PEB 读 cwd 必超红线。曾考虑三条路线，**已选定路线 A**（决策 D3，2026-07-29 锁定）：

#### 路线 A（✅ 选定）：混合策略——启发式优先 + 按需精确

- `processScan` 仍只跑启发式 cwd（保 p99）。
- 新增按需通道 `getProcessCwd(pid)`（与方案 3 同构），读 PEB CurrentDirectory。
- **触发时机**：当某进程启发式 cwd 为空且 `name` 看起来是 dev 进程（node/python/某个 dev server 名）时，**前端在用户展开"未分组"组或选中该进程时**才按需拉精确 cwd。
- 收益：热路径零回归；常见 dev 场景在用户真正关注时拿到精确值。

#### 路线 B（未选）：批量但低频

- 新增一个独立扫描 `processScanWithCwd()`，用 PEB 读 cwd，但**以更低频率独立轮询**（如 10s 一次），结果 merge 进 processPanelStore。
- 代价：多一个轮询；架构上更复杂；但能覆盖"未分组"组里所有进程。

#### 路线 C（未选）：仅在 bench 通过的前提下全量启用

- 把 PEB cwd 读进 `processScan`，**只有当 `pnpm bench` 在目标机器上仍 < 20ms 才启用**。
- 风险：p99 对机器敏感，换机器可能破红线。**不推荐作为默认**，可作为"实验开关"。

> **选定路线 A**（D3）：与方案 3 形成对称（一个按需读 env，一个按需读 cwd），`peb_access` 代码复用度最高。

#### 5.3.1 native 实现（与方案 3 共享）

PEB 读取基础设施抽到 `peb_access.cpp/.h`：

```cpp
// 提供：OpenForRead(pid) -> HANDLE（封装 OpenProcess 标志）
//       ReadPebProcParams(h) -> 远端 RTL_USER_PROCESS_PARAMETERS 副本
// 方案 3 的 env、方案 5 的 cwd 都基于它。
```

cwd 读取：

```cpp
bool ReadProcessCwd(ULONG pid, std::string& cwd, std::string& err) {
  HANDLE h = OpenForRead(pid); if (!h) { err="denied"; return false; }
  auto params = ReadPebProcParams(h);              // 含 CurrentDirectory
  if (!params) { CloseHandle(h); err="no params"; return false; }
  // params->CurrentDirectory.DosPath 是 MY_UNICODE_STRING（远程指针）
  std::wstring w; ReadRemoteUnicodeString(h, &params->CurrentDirectory.DosPath, w);
  CloseHandle(h);
  cwd = WideToUtf8(w);
  // 关键：剥离 \??\ 前缀、NT 设备路径转 DOS（见下）
  return true;
}
```

#### 5.3.2 NT 路径归一化（易错点）

PEB cwd 可能返回：
- `C:\Users\...`（DOS 路径，最常见）—— 直接用。
- `\??\C:\Users\...`（NT 命名空间前缀）—— 剥 `\??\`。
- `\Device\HarddiskVolume3\...`（纯 NT 设备路径）—— 需 `QueryDosDevice` 反查卷符。

`projectGroup.ts` 的 `normPath` 当前**只处理反斜杠和盘符大小写**，需扩展：

```ts
function normPath(p: string): string {
  let s = p;
  if (s.startsWith('\\??\\')) s = s.slice(4);        // 剥 NT 前缀
  // \Device\HarddiskVolume3\... → 需 native 侧用 QueryDosDevice 转好再返回（推荐在 native 转，前端不持有卷映射）
  s = s.replace(/\\/g,'/').replace(/^[a-z]:/, m=>m.toUpperCase()).replace(/\/$/,'');
  return s;
}
```

> 推荐：**NT→DOS 转换在 native 做**（`QueryDosDevice` 遍历卷符建表），前端永远只收 DOS 路径。

### 5.4 实现步骤

1. 抽 `peb_access.cpp/.h`（OpenForRead + ReadPebProcParams + ReadRemoteUnicodeString）。
2. 实现 `ReadProcessCwd`（复用上述）。
3. 注册 `getCwd(pid)` 通道（6 处接线同方案 3）。
4. native 测试：读自身进程 cwd（应等于 `process.cwd()`）。
5. 前端：`projectGroup` 的 `normPath` 扩展前缀剥离。
6. 触发逻辑（路线 A）：未分组组展开时 / 选中进程时，按需拉精确 cwd 并 merge 进 store 的对应 ProcessInfo。
7. **必跑 `pnpm bench`** 确认热路径无回归（因为没动 processScan，应零变化——但仍要验证）。

### 5.5 测试策略

- **native**：自身进程 cwd 正确；System(pid=4) 返回 null 不崩；NT 前缀剥离正确。
- **bench**：`processScan` p99 仍 < 20ms（未改热路径，应为基线值）。
- **集成人工验收**：`npm run dev` 场景下，展开未分组组后该进程归到正确项目组。

### 5.6 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| 路线 A 体验延迟（展开才拉） | 中 | 拉取后缓存 pid→cwd，下次直接用；并在组头显示"刷新 cwd" |
| NT 设备路径转换不全 | 中 | native 侧用 QueryDosDevice 全量建表，转换失败时返回原始并标记 |
| 与启发式 cwd 结果不一致导致分组抖动 | 中 | 精确 cwd 一旦拿到就覆盖启发式值（单一真相源） |

### 5.7 优先级说明

低优先级——因为：当前启发式已覆盖"IDE 以绝对路径启动 node"的主场景；路线 A 的收益主要在 `npm run dev` 类命令。若方案 2（标签规则）落地后，用户对"项目分组"的依赖可通过标签部分补偿。**建议做完 3 再评估**（共用 PEB 代码，边际成本低）。

---

## 方案 6：插件系统

### 6.1 背景与问题

CodeMgr 当前是封闭单体——所有标签规则、面板、数据源都写死在代码里。社区/用户无法扩展。v2.0 设计文档已把"插件系统"列为远期目标。

### 6.2 目标（v2.0 愿景）

- 第三方能写插件扩展：**自定义标签规则**（复用方案 2 的引擎）、**自定义面板/视图**、**自定义数据源**（如读 Docker 容器列表）。
- **安全**：插件运行在受限环境，不能直接碰 native（红线）。
- **隔离**：插件崩溃不影响主 app。

### 6.3 设计（高层，待 v2.0 细化）

#### 6.3.1 分阶段演进（不要一步到位）

| 阶段 | 能力 | 实质 |
|------|------|------|
| **6a（v1.x 内置）** | 方案 2 的标签规则即"配置型插件" | 零代码扩展标签 |
| **6b（v2.0 初）** | JS 插件（sandboxed iframe / Web Worker）能注册标签规则、贡献只读视图 | 受限扩展点 |
| **6c（v2.0+）** | 插件能贡献新数据源（通过受控 IPC 白名单） | 完整扩展 |

#### 6.3.2 安全模型（红线）

- 插件代码**绝不**直接 `require('codemgr-native')` 或访问 `ipcRenderer`。
- 暴露**受控 API**（`window.codemgr.plugin.*`）：只读快照（进程列表、端口）、注册标签规则、贡献 React 组件（作为字符串/远程模块加载）。
- 数据源类插件若需新 native 能力，必须由 CodeMgr 主仓库 review 后加入白名单（不能插件自带 .node）。

#### 6.3.3 技术方向（待调研）

- **iframe 沙箱**：插件跑在独立 iframe（`sandbox` 属性），通过 `postMessage` 与主框架通信。最安全，但能力受限、通信开销。
- **Web Worker + Comlink**：插件逻辑跑 worker，UI 组件用 React 远程组件（`react-remote`). 平衡安全与能力。
- **Electron UtilityProcess**：进程级隔离，最强但最重。

> 这是 v2.0 架构决策，**本稿不锁定**，需单独 spec + 原型验证。

### 6.4 实现步骤（仅 6a 可现在做）

- 6a：完成方案 2 即等于实现"配置型标签插件"。无需额外工作。
- 6b/6c：留待 v2.0，先做安全原型 spike。

### 6.5 风险

| 风险 | 等级 | 对策 |
|------|:---:|------|
| 安全漏洞（插件逃逸沙箱） | 高 | 严守受控 API；不暴露 ipcRenderer；code review 门禁 |
| 插件质量参差拖垮主 app | 中 | 隔离 + 崩溃熔断 + 性能预算 |
| API 设计反复 | 中 | 先用方案 2 沉淀 6-12 个月再固化 |

### 6.6 优先级说明

低——且**强烈建议先做 6a（=方案 2）**，让"扩展点"以最小成本落地并接受真实用户检验，再决定 6b/6c 的投入。避免过早设计插件 SDK。

---

## 已确认决策（2026-07-29 锁定）

| 编号 | 决策 | 选定 | 影响 |
|------|------|------|------|
| **D1** | 布局库 | **`react-mosaic-component`**（自由拆分/嵌套） | 方案 1 采用 mosaic；`LayoutNode` 二叉树模型落地；`allotment` 仅作 ProcessPanel 内部侧栏可调宽的轻量补充 |
| **D2** | 标签规则模式 | **支持数组 AND**（`pattern: string \| string[]`） | 方案 2 的 `LabelRule` 模型定稿；现有 "vite AND build" 规则可 1:1 迁移为单条规则 |
| **D3** | cwd 精确化路线 | **路线 A：按需精确** | 方案 5 采用按需通道；与方案 3 共用 `peb_access` 代码；`processScan` 热路径零改动、零红线风险 |
| **D4** | 实施范围 | **6 个方向全部纳入** | 进入版本排期，详见 `docs/superpowers/plans/2026-07-29-codemgr-roadmap-plan.md` |

> 决策已锁定，后续实现以本表为准。如需变更，走 spec 修订流程（更新本表 + 关联 plan）。

---

## 附：与现有规范的对齐检查

| 规范项 | 本方案是否遵守 |
|--------|:---:|
| 渲染层不直接 require native（红线） | ✅ 方案 3/5 都走完整 IPC 链路 |
| 新 native collector 单文件单职责 | ✅ process_env.cpp / peb_access.cpp 独立 |
| 性能敏感改动跑 `pnpm bench` | ✅ 方案 5 明确要求 |
| Conventional Commits + 分支 | ✅ 每方案可拆 feat/fix 分支 |
| 新代码有测试 | ✅ 每方案都列了 TDD/人工验收 |
| 更新 CHANGELOG | ✅ 落地时按版本追加 |
| kill 路径复用 IsProtected | N/A（无新 kill 路径） |
