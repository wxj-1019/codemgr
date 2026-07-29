# CodeMgr A1 — 纯前端 Bug 修复包（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 方法：brainstorming skill（分解 → 澄清 → 方案 → 逐段设计 → 用户逐段获批）。
> 上游审查：`2026-07-30-codemgr-aurora-ui.md`（同日，独立轨道）。

---

## 0. 背景与定位

在 2026-07-30 的全量审查中，识别出 6 个产品能力增强方向（A bug 修复、B workspace 身份、C 聚焦上下文、D 诊断导出、E AI session、F run profiles）及若干已存在的行为错误。本 spec 只处理其中**风险最低、不依赖新架构**的一批：A1。

A1 的价值不在于新功能，而在于**让现有面板的行为可信**——排序、选择、分组、快照这四件事目前都有"数据对、行为错"的问题，会直接误导用户（尤其是批量结束这类危险操作）。修复它们是后续 C/E 跨面板联动的前提：联动建立在"面板自身行为正确"之上。

A1 故意排除采集失败语义（审查编号 #4）——那是一个跨 main/preload/hooks 的 IPC 类型重构，风险特征不同，留作独立 spec（A2）。

---

## 1. 范围

### 1.1 包含（4 个纯前端 bug）

| # | Bug | 一句话 | 受影响文件 |
|---|-----|--------|-----------|
| 1 | 进程排序被 buildTree 覆盖 | 表头排序先生效，buildTree 又按 PID 重排，覆盖用户选择 | `app/src/components/ProcessTable.tsx` |
| 2 | "全选"选中折叠隐藏的子进程 | 全选目标是扁平 sorted，含折叠隐藏的子进程；批量结束直接用全部选中 | `ProcessTable.tsx`、`app/src/components/ProcessPanel.tsx` |
| 3 | 同名 worktree 用 basename 做 key/展开态 | 两个 `...\app` 共享 React key 与展开状态 | `app/src/lib/projectGroup.ts`、`app/src/components/ProjectGroupView.tsx`、`app/src/store/processPanelStore.ts` |
| 5 | 快照 changed 被 workingSetBytes 波动淹没 | 内存任意波动都进 changed，淹没真正的结构变化 | `app/src/lib/snapshotDiff.ts` |

（编号沿用审查报告。#4 采集失败语义不在本 spec。）

### 1.2 明确不做

- **#4 采集失败语义**（`Result<T>` + `sampledAt`/`lastSuccessAt`）——跨层 IPC 类型重构，单独 spec（A2）。
- 任何 `codemgr-native/` 或 `app/electron/` 改动——本 spec 全部在 `app/src/` 与 `app/tests/` 内。
- 任何 IPC 接口形状变更。
- Aurora 视觉重设计（`2026-07-30-codemgr-aurora-ui.md`，独立轨道）。
- 子项目 B workspace 身份模型。

### 1.3 成功标准

- 全部既有测试通过（含对固化了错误行为的测试的更新）。
- 每个 bug 附回归测试，覆盖修复行为。
- `cd app && pnpm typecheck` 绿。
- `cd app && pnpm vitest run` 绿。
- 既有 IPC 接口形状不变（native / main / preload 零改动）。
- 默认状态（`sortKey: 'pid'`, `sortAsc: true`, 无折叠）下行为与现状一致，零回归。

---

## 2. Bug #1 — 进程排序被 buildTree 覆盖

### 2.1 根因

`ProcessTable.tsx` 中：
- `sorted`（约 :274）已按 `sortKey`/`sortAsc` 正确排序。
- 但 `buildTree()`（:26）在 `:39`（children）和 `:53`（roots）各自执行 `children.sort((a, b) => a.pid - b.pid)` / `roots.sort((a, b) => a.pid - b.pid)`，把上层排序覆盖回 PID 升序。

结果：用户点 CPU/GPU/内存/名称表头，视觉上多数情况下无变化或仅顶层略变。

### 2.2 修复（方案甲：buildTree 保留输入顺序）

`buildTree` 回归"纯结构构建"职责——只建立父子关系与 DFS 遍历，**不排序**。顺序由调用方（`sorted`）唯一决定。

具体改动（`app/src/components/ProcessTable.tsx`）：
- 删除 `children.sort((a, b) => a.pid - b.pid)`（:39）。
- 删除 `roots.sort((a, b) => a.pid - b.pid)`（:53）。
- 更新 `buildTree` 注释：明确"顺序由上层 sorted 决定；本函数只建父子关系"。

### 2.3 边界与回归保证

- 展开/折叠不影响兄弟顺序——顺序由 `sorted` 决定，每次重算都基于当前 sorted，稳定可预测。
- `sortKey` 默认 `'pid'` + `sortAsc: true` 时，上层 sorted 即按 PID 升序，删除 buildTree 内部排序后行为与现状完全一致——**零回归**。
- `children.sort` 删除后，同一父的子节点顺序 = 它们在 `sorted` 中的相对顺序，由用户选择的排序键决定。

### 2.4 回归测试

新增 `app/tests/processTableSort.test.tsx`（渲染 `ProcessTable`，断言行顺序）：
1. 3 个独立进程（pid 1/2/3，CPU 10/50/30），点 CPU 表头降序 → 行顺序 pid 2,3,1（CPU 50,30,10）。
2. 父子结构（root pid 1 CPU 50，child pid 2 CPU 10），展开 root → child 紧随 root（DFS 保留上层顺序）。
3. 切回 PID 升序 → 行顺序恢复 pid 1,2,3。

---

## 3. Bug #2 — "全选"选中折叠隐藏的子进程

### 3.1 根因

`ProcessTable.tsx` 表头全选 checkbox（:475）调用 `selectAll(sorted.map(p => p.pid))`。`sorted` 是过滤后的**扁平**列表，含所有匹配项——包括因父节点折叠而不可见的子进程。

后果：用户看到 3 个根进程（子进程折叠），点全选，实际选中含隐藏子进程在内的全部匹配 PID。批量结束（`ProcessPanel.tsx:92` `doBatchKill`）直接用整个 `selectedPids`，确认框（:293）只显示数量，不暴露隐藏项。

### 3.2 修复（方向 X：全选只选可见行）

全选目标从 `sorted`（扁平匹配）改为 `rows`（实际渲染的显示行 = buildTree 输出，已剔除折叠隐藏项）。

具体改动：
- **`app/src/components/ProcessTable.tsx`**：
  - 表头 checkbox `onChange`：`selectAll(rows.map(r => r.proc.pid))` 替代 `selectAll(sorted.map(p => p.pid))`。
  - `allSelected` 判定：`rows.every(r => selectedPids.has(r.proc.pid))` 替代 `sorted.every(p => selectedPids.has(p.pid))`（约 :316）。
  - aria-label "全选当前列表" → "全选可见行"。
- **`app/src/store/processPanelStore.ts`**：`selectAll` 签名不变（已支持 `pids?: number[]`，:137）。无参时向后兼容（选所有进程）。仅调用方传入的 pid 集合语义从"所有匹配"变为"所有可见"。

### 3.3 边界

- 过滤/折叠/排序变化导致 `rows` 变化时，已选但不再可见的 PID **保留**在 `selectedPids`（不主动清除）——避免用户折叠一下就丢选择。下次"全选"基于新 `rows` 重算。
- header 的"已选 N 个"显示（`ProcessPanel.tsx:190`）不变，显示真实选中总数，用户始终可见。
- 语义上 `selectedPids` 仍可能含不可见项；但"全选"这个动作本身不再悄悄选入隐藏项——危险来源被堵住。

### 3.4 回归测试

扩展 `app/tests/processTableVirtual.test.tsx` 或新建 `processTableSelect.test.tsx`：
1. root + 2 个折叠子进程，点全选 → 只有 root 被选中，子进程未选中。
2. 展开后再点全选 → root + 子进程都被选中。
3. 过滤后再点全选 → 只有匹配且可见的行被选中。

---

## 4. Bug #3 — 同名 worktree key 冲突

### 4.1 根因

- `groupByProject`（`app/src/lib/projectGroup.ts`）的分组 Map 键是规范化完整路径 `dir`——**分组正确**，不同路径不合并。
- 但 `ProjectGroup.name` = `lastSegment(cwd)`（basename）。
- UI（`ProjectGroupView.tsx:272/278/284`）用 `g.name` 作 React key 与 `expandedGroups` 展开状态键。
- `processPanelStore.ts:127` `toggleGroup(name)` 也以 name 为键。

两个 `...\app`（不同完整路径）→ 分组正确（2 组），但 basename 相同 → React key 冲突 + 展开态共享。

### 4.2 修复（方向 P1：冲突时加父路径消歧）

核心原则：**identity 键始终用规范化完整路径 `dir`；`name` 只负责显示。**

具体改动：

**`app/src/lib/projectGroup.ts`**：
- `ProjectGroup` 接口不变（`name` 显示名，`dir` 规范化路径）。
- 新增**显示名消歧**：`groupByProject` 返回前，检测 basename 冲突。
- **消歧算法**（确定、纯函数）：
  1. 对所有 `dir !== null` 的组，计算 `lastSegment(dir)` 作为初始 `name`。
  2. 统计每个 `name` 的出现次数。无重复的组 `name` 保持 basename。
  3. 对有重复的组，`name` 改为 `parentSegment(dir) + '/' + lastSegment(dir)`（取倒数第二段 + 最后一段，如 `proj/app`）。
  4. 若再次出现重复，继续向上一级拼接（`grandparent/parent/last`），直到组间 `name` 唯一。实践中倒数两段几乎必然唯一（同 repo 下同名同父目录罕见）。
  5. 段不足（无父段）时退化为完整规范化 `dir`。
- 未分组（`dir: null`，`name: '未分组'`）不参与消歧。

**`app/src/components/ProjectGroupView.tsx`**：
- React key：`g.dir ?? g.name`（有 dir 用 dir，未分组用 name）。dir 已规范化，保证唯一。
- `expandedGroups` 判定与 `onToggle`：改用 `g.dir ?? g.name` 作组 identity 键。

**`app/src/store/processPanelStore.ts`**：
- `expandedGroups: Set<string>` 语义从"组名集合"改为"组 identity 键集合"（规范化 dir 或 `'未分组'`）。
- `toggleGroup(key)` 参数语义随之变为 identity 键；签名不变。

### 4.3 边界与迁移

- `expandedGroups` **不在** `partialize` 白名单（`processPanelStore.ts:159` 不含它）——运行时态，不持久化，**无迁移问题**。
- 消歧只改 `name`（显示），不改 `dir`（分组键）——分组正确性不受影响。
- 消歧是纯函数，输入确定则输出确定，可 TDD。
- `projectGroup.ts` 现有 NT 前缀剥离逻辑（`\??\` / `\\?\`）不受影响。

### 4.4 回归测试

扩展 `app/tests/projectGroup.test.ts`：
1. 两个同名不同路径（`C:\proj\app`、`C:\worktrees\x\app`）→ 2 组，`dir` 不同，`name` 消歧为 `proj/app` 与 `x/app`（逐级到不冲突）。
2. 深层同名（`a/x/app`、`b/y/app`）→ 消歧到父段唯一。
3. 无冲突时 `name` 保持 basename——现有 12 个用例不应因消歧逻辑挂（回归保护）。
4. identity 键唯一性：`dir` 在结果集中唯一。

---

## 5. Bug #5 — 快照 changed 被 workingSetBytes 波动淹没

### 5.1 根因

`snapshotDiff.ts:43` `entryChanged()` 把 `workingSetBytes` 的**任意**变化算 changed（:48）。正常存活进程（dev server）每轮刷新内存都会波动，导致快照"有变化"列表被内存抖动淹没。

源码注释（:13-17）自己声明"内存抖动不应被当成进程变了"，但实现与注释相反；`snapshotDiff.test.ts:96` 的 "workingSetBytes change alone counts as changed" 固化了这个错误行为。

### 5.2 修复（方向 A：内存移出 changed）

`entryChanged()` 只比较结构字段，移除 `workingSetBytes`。

具体改动（`app/src/lib/snapshotDiff.ts`）：
- `entryChanged()` 删除 `before.workingSetBytes !== after.workingSetBytes`（:48）。
- 保留：`name !== name || cmdline !== cmdline || cwd !== cwd`。
- 更新顶部注释（:13-17）：changed 判定字段改为 name/cmdline/cwd；说明移除 workingSetBytes 的理由。

### 5.3 安全性论证

- 进程重 exec（`node` → `deno`）会改 name 与 cmdline → 仍进 changed。
- 同进程 cwd 变化（chdir）→ 仍进 changed。
- workingSetBytes 变化是常态而非异常。真正的内存泄漏/资源异常检测属于"资源异常"范畴，应留给后续子项目 E（AI Session 资源聚合），不塞进快照身份 diff。

### 5.4 测试更新

`app/tests/snapshotDiff.test.ts`：
- **改写** :96 的固化测试：`"workingSetBytes change alone does NOT count as changed"`，断言 `d.changed.toHaveLength(0)`。
- 现有 `"detects changed entries"`（:84，改 cmdline）仍通过。
- 新增：workingSet 变化 + cmdline 变化 → 仍进 changed（确认内存移出不影响结构变化捕获）。

---

## 6. 测试策略

- **TDD**：#1/#2/#3/#5 均为纯逻辑或组件渲染，先写/改测试再改实现。
- 既有测试必须保持绿——消歧逻辑（#3）尤其要确认现有 12 个 `projectGroup` 用例不挂。
- 每个 bug 至少 1 个针对性回归测试，覆盖"修复前会失败、修复后通过"的行为。
- 验收命令（AGENTS.md §4）：`cd app && pnpm vitest run`（全绿）+ `cd app && pnpm typecheck`（绿）。

---

## 7. 风险与回滚

- **整体风险：低**。全部改动在 `app/src/` 与 `app/tests/`，无 native / main / preload / IPC 接口变更。
- **#3 风险最高**：identity 键从 name 迁到 dir 涉及 store 字段语义，但因不持久化故无数据迁移风险；需确保 `ProjectGroupView` 所有引用点统一用 `dir ?? name`。
- 回滚：纯前端，单 commit 可回退；无 ABI / 迁移 / 外部副作用。

---

## 8. 不在本 spec 的后续工作（路线衔接）

- **A2（独立 spec）**：#4 采集失败语义——`Result<T>` + `sampledAt`/`lastSuccessAt`，跨 main/preload/hooks。
- **B（独立 spec）**：Workspace / Git 身份模型——本 spec 的 #3 只解决"同名 worktree 不冲突"，B 才提供真正的 workspaceId / git root / branch。
- **C**：全局聚焦上下文（依赖 B）。
- **D**：诊断上下文导出（轻度依赖 B）。
- **E**：AI Session 图谱（依赖 B、C）。
- **F**：Run Profiles + Dev Service（依赖 B、E）。
