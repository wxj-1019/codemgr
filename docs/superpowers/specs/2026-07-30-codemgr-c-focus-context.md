# CodeMgr C — 全局聚焦上下文（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：审查报告产品能力增强方向 C；依赖 B（workspace 身份可选用于显示）。
> 方法：brainstorming skill（调研 → 核心决策点用户未答，采用推荐方案：新增 focusedPid 单值，保留多选 → 设计锁定）。
> 产品决策（采用推荐）：**新增全局 `focusedPid`（单值），与进程表多选（批量结束）并存且独立**。focusedPid 是"当前关注哪个进程"，驱动跨面板联动高亮 + 定位；多选仍只服务于批量结束。

---

## 0. 背景与问题

当前四个面板的"选中态"各自孤立：
- **进程面板**：`processPanelStore.selectedPids: Set<number>`（多选，驱动侧栏 + 批量结束）。
- **端口雷达**：`portRadarStore.selectedPid: number | null`（单选，仅高亮端口行，**不联动进程**）。
- **PerfPanel GPU Top5**：纯展示，PID 行不可点击，无法定位进程。
- **快照面板**：本地 `selectedPids`（diff 内多选，用于结束新增项，与进程面板隔离）。

后果：用户在端口雷达看到一个可疑的 5173 占用，想看它的进程详情/命令行/父链，得手动切到进程面板再搜 PID。GPU Top5 显示某进程吃满显存，也无法定位。各面板是"并排的独立监视器"，不是统一工作台。

本 spec 引入全局 `focusedPid`，让端口/GPU Top/快照项点击后能"定位到"进程，进程详情侧栏跟随焦点。

---

## 1. 范围

### 1.1 包含

新增 `focusStore`（全局 `focusedPid: number | null` + `sourcePanel`），提供：
- **端口→进程定位**：点端口行 → 设 focusedPid → 进程表滚动到该行 + 高亮 + 侧栏显示其详情。
- **GPU Top→进程定位**：点 GPU Top5 的 PID 行 → 设 focusedPid → 同上。
- **快照→进程定位**：快照 diff 的 added/changed 行点"定位" → 设 focusedPid → 同上（仅当该进程仍存活）。
- **进程表消费 focusedPid**：高亮该行（区别于多选的选中态）+ 首次聚焦时滚动到可见。
- **侧栏跟随**：`ProcessDetailSidebar` 在没有多选时跟随 focusedPid 显示详情（与现有 selectedPids 单选逻辑融合）。

**纯渲染层 + 一个新 store**。无 IPC / native / 热路径改动。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/src/store/focusStore.ts`（新建） | 全局 focusedPid + sourcePanel + setter |
| `app/src/components/ProcessTable.tsx` | 消费 focusedPid：高亮 + 滚动定位 |
| `app/src/components/PortTable.tsx` + `PortRadar.tsx` | 端口行点击 → setFocusedPid |
| `app/src/components/PerfPanel.tsx` | GPU Top5 PID 行可点击 → setFocusedPid |
| `app/src/components/SnapshotPanel.tsx` | diff 行加"定位"按钮 → setFocusedPid |
| `app/src/components/ProcessDetailSidebar.tsx` | 无多选时跟随 focusedPid |
| `app/tests/focusStore.test.ts`（新建） | store TDD |

### 1.3 明确不做

- **不改多选**。`selectedPids` 批量结束工作流完全不动；focusedPid 是独立的单值。
- **不做 workspace 聚合**（那是 B 的延伸，且产品决策为仅展示）。focusedPid 是进程级，不引入 workspaceId 聚焦。
- **不做跨机器/远程聚焦**。
- **不持久化 focusedPid**（运行时态，重启清空——进程 PID 跨会话无意义）。
- **不自动聚焦**（不因进程新建/退出自动改焦点，避免抢用户注意力）。聚焦只由用户点击触发。
- **端口雷达的 selectedPid 不删除**（保持端口表内部高亮），但它额外触发 focusedPid。

### 1.4 成功标准

- 点端口行 → 进程表对应行高亮（聚焦样式）+ 滚动到可见 + 侧栏显示详情。
- 点 GPU Top5 PID → 同上。
- 快照 diff 行"定位" → 同上（进程存活时；已退出则提示）。
- focusedPid 与 selectedPids 独立：聚焦一个进程不清空多选，多选不影响聚焦高亮。
- 进程退出后 focusedPid 自动清空（防指向幽灵）。
- 既有测试全绿。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- 无 IPC / native 改动。

---

## 2. focusStore 设计

新建 `app/src/store/focusStore.ts`：

```ts
import { create } from 'zustand';

export type PanelSource = 'port' | 'process' | 'perf' | 'snapshot';

interface FocusState {
  /** 全局聚焦的进程 PID（单值）。null=无聚焦。与 selectedPids（多选）独立。 */
  focusedPid: number | null;
  /** 触发聚焦的来源面板（用于调试/未来 UI 提示，首版仅存储）。 */
  sourcePanel: PanelSource | null;
  /** 设聚焦。pid=null 清空。 */
  focus: (pid: number | null, source?: PanelSource) => void;
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedPid: null,
  sourcePanel: null,
  focus: (pid, source = null) => set({ focusedPid: pid, sourcePanel: pid == null ? null : source }),
}));
```

**为何独立 store 而非放 processPanelStore**：focusedPid 被端口/性能/快照面板写入，逻辑上属于"全局"，放进程专属 store 会让其它面板反向依赖进程 store。独立 store 边界清晰。

**不持久化**：无 persist middleware（PID 跨会话无意义）。

---

## 3. 各面板联动

### 3.1 ProcessTable（消费 focusedPid）

- 读取 `useFocusStore.focusedPid`。
- **高亮**：行样式加聚焦态（如 `ring-accent`，与多选选中态 `bg-base-700/50` 区分——聚焦用左侧 2px 光条 + 不同色）。
- **滚动定位**：focusedPid 变化时，若该行不在可视区，滚动到可见（虚拟化用 virtualizer.scrollToIndex，非虚拟化 scrollIntoView）。复用现有 focusedPid 滚动 effect 的模式（ProcessTable 已有 internal focusedPid 用于键盘导航——**注意命名冲突**，见 §5）。
- **点击进程行也设聚焦**：进程表内点击行（现有 toggleSelect 改多选）额外设 focusedPid（source='process'），让侧栏跟随。

### 3.2 PortTable / PortRadar（写入 focusedPid）

- PortTable 行点击：现有 `onSelect(c.pid)`（设 portRadarStore.selectedPid）保留；**额外**调 `useFocusStore.focus(c.pid, 'port')`。
- 即点端口行同时：高亮端口行（既有）+ 设全局聚焦 → 进程表定位。

### 3.3 PerfPanel GPU Top5（写入 focusedPid）

- GPU Top5 的 PID 行（当前纯 `<tr>`）加 `onClick={() => focus(p.pid, 'perf')}` + `cursor-pointer` + hover 样式。
- 点击 → 设聚焦 → 进程表定位（若进程面板在布局中）。

### 3.4 SnapshotPanel diff（写入 focusedPid）

- diff 的 added/changed 行加"定位"按钮（小链接，仅 added 项——removed 项已退出无法定位）。
- 点击 → `focus(entry.pid, 'snapshot')`。
- 进程表定位时若该 PID 已不存在（快照后退出），focusedPid 仍设但进程表无对应行——§3.5 的清理逻辑不会误清（清理只在 processScan prune 时）。

### 3.5 focusedPid 自动清理

进程退出后 focusedPid 应清空，防指向幽灵进程。在 `processPanelStore.setProcesses` 的 prune 逻辑里加：若新 pidSet 不含 focusedPid，则 `useFocusStore.getState().focus(null)`。

（focusStore 与 processPanelStore 跨 store 调用——setProcesses 内 `import { useFocusStore }` 取 getState 调 focus(null)。这是单向依赖：process 清理通知 focus，合理。）

### 3.6 ProcessDetailSidebar 跟随

现有侧栏逻辑：`selectedPids.size === 1` 时显示该进程详情。改为：
- 优先级：`selectedPids.size === 1` → 显示 selectedPids 唯一项（多选单选态）。
- 否则若 `focusedPid != null` → 显示 focusedPid 的详情。
- 即"无显式多选单选时，侧栏跟随全局聚焦"。

这让端口/GPU/快照聚焦后侧栏自动显示该进程详情（即使进程面板没有选中它）。

---

## 4. 命名冲突处理（关键）

ProcessTable 已有内部 `focusedPid` state（`:361`，键盘导航用，roving tabindex 的焦点框）。这与全局 focusedPid **同名但语义不同**：
- 内部 `focusedPid`：键盘导航焦点框（↑↓ 移动），纯 UI 局部态。
- 全局 `focusedPid`：跨面板聚焦的进程身份。

**决策**：重命名内部为 `navFocusPid`（导航焦点），全局保持 `focusedPid`。避免混淆。改动集中在 ProcessTable 一处（state 名 + 引用）。

---

## 5. 测试策略

### 5.1 focusStore TDD（`app/tests/focusStore.test.ts`）

1. 初始 focusedPid === null。
2. focus(pid, 'port') → focusedPid/sourcePanel 正确设置。
3. focus(null) → 清空 + sourcePanel 也清空。
4. focus(pid) 不传 source → sourcePanel 默认 null。

### 5.2 ProcessTable 聚焦高亮（扩展测试）

- 设 focusedPid → 对应行有聚焦样式（data-focused 属性或 class 断言）。
- focusedPid 与 selectedPids 独立：聚焦行不被误判为选中。

### 5.3 端口/GPU/快照写入（人工验收）

点击联动需真实交互，jsdom 难验证滚动；高亮/聚焦态由 store 测试 + 组件测试覆盖。

### 5.4 回归

既有测试全绿（重命名 navFocusPid 不改行为）。

---

## 6. 风险与回滚

- **风险：低-中**。纯渲染层 + 新 store，无 IPC/native。主要风险是 ProcessTable 重命名遗漏引用 + 跨面板 store 调用的清理时机。
- **缓解**：typecheck 捕获重命名遗漏；focusStore 清理用 getState 单向调用，无循环依赖。
- **回滚**：纯新增 store + 组件改动，单 commit 可回退。

---

## 7. 路线衔接

- **D（诊断导出）**：D 目前用 selectedPids 聚合诊断；C 后可改为跟随 focusedPid（聚焦谁就诊断谁），体验更顺。D 先做不依赖 C（用 selectedPids），C 后可小幅调整 D 入口。
- **E（AI Session）**：session 可设"聚焦 session"，复用 focusStore 扩展为 focusedSessionId。
