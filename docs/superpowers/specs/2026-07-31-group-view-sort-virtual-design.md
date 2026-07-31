# 项目分组视图排序与虚拟滚动设计

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 三（一致性）

## 1. 问题

树形视图（ProcessTable）有列排序和 >100 行虚拟列表；项目分组视图（ProjectGroupView）两者皆无。大项目场景（上百进程、展开多个组）下分组视图会渲染全部 DOM 行，且无法按 CPU/内存找组内大户——两视图能力不对等。

## 2. 目标 / 非目标

**目标**
- 排序：组级按「项目名 / 合计内存」、组内进程按「名称 / CPU% / 内存 / PID」，点击表头切换升/降序（与树形视图交互一致）。
- 虚拟滚动：扁平化行（组头 + 已展开组内进程）>100 行启用 @tanstack/react-virtual，与树形视图同 spacer 方案。
- 排序态组件本地（不持久化），切换视图不残留。**默认不排序**（保持组按大小降序、组内采集序的现状），点表头进入 asc → desc → 回到默认原序（2026-07-31 与多选模式合流时修正，避免静默改变既有默认顺序）。

**非目标（YAGNI）**
- 组级按 CPU/进程数排序、排序预设持久化（评审已决策不做预设）。
- 分组视图键盘导航（树形视图已有；分组视图补齐另立项）。

## 3. 设计

### 3.1 排序纯逻辑（`app/src/lib/groupSort.ts`，TDD）
```ts
type GroupSortKey = 'name' | 'cpu' | 'memory' | 'pid';
type SortDir = 'asc' | 'desc';
sortGroups(groups, key, dir)      // name→按组名；memory→按合计内存；cpu/pid→保持原序（组级无意义）
sortGroupProcs(procs, key, dir, cpuMap)  // 四键均可
```
稳定排序（同值保持原相对序），默认 `name/asc`。

### 3.2 ProjectGroupView 改造
- `const [sort, setSort] = useState<{ key: GroupSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' })`；表头 `项目/名称`（name）、`CPU%`（cpu）、`内存/MB`（memory）、`PID`（pid）可点（button + 方向符 ▲▼，照 ProcessTable 表头模式）。
- 应用顺序：filter → groupByProject → sortGroups → 每组 procs 经 sortGroupProcs。
- 扁平化 `rows: GroupViewRow[]`（`{type:'group'}` | `{type:'proc'}`，仅展开组贡献 proc 行），`rows.length > 100` 启用 virtualizer：`estimateSize` 按行型（group 37px / proc 29px）、`overscan: 10`、上下 spacer `<tr>`（colSpan=8）撑总高——与 ProcessTable 虚拟化同构。
- GroupRow 拆为 `GroupHeaderRow`（组头）+ `GroupProcRow`（组内进程行），虚拟窗口逐行渲染。

## 4. 测试（TDD）

- `groupSort.test.ts`：组级 name/memory 双向、cpu/pid 组级透传原序、组内四键双向、稳定性（同值原序）。
- `projectGroupViewVirtual.test.tsx`：≤100 行全渲染无 spacer；>100 行窗口化（首组头可见、总行数 < 全量）；展开/收起改变行数后窗口正确。
- 既有 projectGroup/processTableVirtual 测试不回归。

## 5. 验收（人工）

1. 展开多个大组（总行数 >100）：滚动流畅，行数窗口化。
2. 点「内存/MB」：组按合计内存排序、组内进程按内存排序；再点反向。
3. 排序后展开/收起组、切换过滤，行为正确无错位。
