# CodeMgr A2 — 采集失败语义（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：审查报告 #4 + A1 spec（`2026-07-30-codemgr-a1-bugfix-pack.md`）明确将本项排除出 A1，留作独立 spec。
> 方法：brainstorming skill（调研 → 决策点全部可从架构推断 → 设计锁定）。

---

## 0. 背景与问题

CodeMgr 的采集 IPC（`fetchProcesses`/`fetchConnections`/`fetchPerf`）在 main 层用 `try { native.fn() } catch { return 降级值 }` 吞掉异常：

- `processScan()` 失败 → `main.ts:141-148` 返回 `[]`
- `netScan()` 失败 → `main.ts:78-85` 返回 `[]`
- `perfCounters()` 失败 → `main.ts:159-166` 返回 `null`

后果：`ipc.invoke` **永不 reject**，hooks 的 `catch` 分支只在自身封装出错时触发。native 采集失败被转成"空数据"，渲染层无法区分三种状态：

1. **真的没有数据**（例如确实没有监听端口）——应显示空态。
2. **采集器失败**（权限/原生崩溃/资源耗尽）——应显示错误 + 保留上次成功数据并标陈旧。
3. **首载失败**——应显示错误态（无旧数据可保留）。

现状下三种都显示成"无数据"，用户（尤其 AI 开发者排障时）会被误导：以为"没有 node 进程"，实际是 `NtQuerySystemInformation` 失败了。

本 spec 让采集失败**可见、可区分、可恢复**。

---

## 1. 范围

### 1.1 包含

为三个轮询采集通道（`fetchProcesses`/`fetchConnections`/`fetchPerf`）引入**结构化结果**，取代当前的"降级值即空数据"：

```ts
type CollectResult<T> =
  | { ok: true; data: T; sampledAt: number }
  | { ok: false; error: { code: string; message: string }; lastSuccessAt: number | null };
```

- `ok: true`：采集成功，`data` 是真实结果（可能为空数组——真无数据）。
- `ok: false`：采集失败，`error` 描述原因；`lastSuccessAt` 是上次成功采样时间（null=从未成功）。
- 渲染层据 `ok` 分支：失败时**保留上次成功数据**（不清空），并在 UI 标注"数据陈旧（上次成功 N 秒前）"+ 可选重试。

### 1.2 受影响通道（仅轮询采集，3 个）

| 通道 | main handler | hook | store |
|------|-------------|------|-------|
| `fetchProcesses` | `main.ts:141` | `useProcessPanel.ts:30` | `processPanelStore.setProcesses` |
| `fetchConnections` | `main.ts:78` | `usePortRadar.ts:36` | `portRadarStore.setConnections` |
| `fetchPerf` | `main.ts:159` | `usePerf.ts:28` | `perfStore.setPerf` |

### 1.3 明确不做

- **按需通道不改**（`fetchCwd`/`fetchProcessEnv`/`killXxx`/snapshot/plugin）。它们已是 `null`/`false` 降级，消费点单一（侧栏按钮），失败语义已足够清晰，且不涉及"清空 vs 保留"问题。改它们会扩大范围且收益低。
- **不引入重试退避/断路器**。失败时下一轮轮询自然重试；`pollMs` 已由用户控制。YAGNI。
- **不改 native 层**。native 抛错是正确的（失败应抛），由 main catch 转结构化结果。native 零改动。
- **不改错误文案的 i18n**。错误消息来自 native 异常的 `String(e)`，直接透传。

### 1.4 成功标准

- 采集失败时 UI 显示明确错误（非"无数据"），且**保留上次成功数据**（不清空表格/图表）。
- 首载失败显示错误态（无旧数据时）。
- 采集成功但结果为空时显示正常空态（不被误判为失败）。
- `lastSuccessAt` 在 UI 可见（"上次成功 N 秒前"）。
- 既有测试全绿（更新受影响的 mock/store 测试）。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- native / preload 通道名不变（仅 main 的 handler 返回形状 + preload 的类型签名变）。

---

## 2. 类型设计

新增到 `app/electron/ipc-types.ts`：

```ts
/**
 * 轮询采集的结构化结果（A2）。取代原先"失败返回空数组/null"的降级，
 * 让渲染层区分"真无数据"与"采集器失败"。
 *
 * - ok:true  采集成功；data 可能为空数组（真无数据）。
 * - ok:false 采集失败；error 描述原因，lastSuccessAt 为上次成功时间（null=从未成功）。
 *   渲染层应保留上次成功 data（不清空）并标注陈旧。
 */
export type CollectResult<T> =
  | { ok: true; data: T; sampledAt: number }
  | { ok: false; error: { code: string; message: string }; lastSuccessAt: number | null };
```

`ExposedApi` 的三个轮询方法签名改为返回 `CollectResult`：

```ts
fetchProcesses(): Promise<CollectResult<ProcessInfo[]>>;
fetchConnections(): Promise<CollectResult<NetConnection[]>>;
fetchPerf(): Promise<CollectResult<PerfData>>;
```

（`fetchCpu` 是 `useProcessPanel` 内的 best-effort 附带采集，已有独立 try/catch，失败只 log——保持现状，不改成 CollectResult，避免范围蔓延。见 `useProcessPanel.ts:36-45`。）

---

## 3. 各层改动

### 3.1 main（`app/electron/main.ts`）

三个 handler 从"catch 返回降级值"改为"catch 返回 `CollectResult` 失败分支"：

```ts
// processScan
ipcMain.handle(IPC.FETCH_PROCESSES, async () => {
  try {
    const data = native.processScan();
    return { ok: true as const, data, sampledAt: Date.now() };
  } catch (e) {
    console.error('processScan failed:', e);
    return { ok: false as const, error: { code: 'PROCESS_SCAN_FAILED', message: String(e) }, lastSuccessAt: lastProcessScanAt };
  }
});
```

需在 main 顶部维护三个"上次成功时间"变量：

```ts
let lastProcessScanAt: number | null = null;
let lastNetScanAt: number | null = null;
let lastPerfAt: number | null = null;
```

成功分支赋值 `lastXxxAt = Date.now()`（在返回前）。

`netScan`/`perfCounters` 同构。`code` 字段：`PROCESS_SCAN_FAILED` / `NET_SCAN_FAILED` / `PERF_FAILED`。

### 3.2 preload（`app/electron/preload.ts`）

无需改逻辑——`ipcRenderer.invoke` 透传返回值。但 `ExposedApi` 类型签名变了（§2），preload 的 `api` 对象实现的是 `ExposedApi`，TS 会自动校验对齐。preload 代码本身零改动（invoke 返回值原样透传）。

### 3.3 hooks（消费 CollectResult）

三个 hook 的 `poll()` 改为解构 `CollectResult`：

```ts
// useProcessPanel（示意）
const result = await ipc.fetchProcesses();
if (stoppedRef.current) return;
if (result.ok) {
  setProcesses(result.data);
  firstRef.current = false;
  // 采集成功但仍跑 CPU 附带采集（best-effort 不变）
  ...
} else {
  // 失败：不清空 processes，setError + 标陈旧时间
  setError(result.error.message);
  setStaleAt(result.lastSuccessAt);  // 新 store 字段
  if (isFirst) firstRef.current = false;  // 首载失败也结束 loading
}
```

`usePortRadar`/`usePerf` 同构。注意 `usePerf` 当前对 `null` 的处理（`:33-35`）被新的 `result.ok` 分支取代。

### 3.4 stores（新增 staleAt + 失败时不清空）

三个 store 各新增：

```ts
staleAt: number | null;        // 上次成功采样时间；null=数据新鲜或从未成功
setStaleAt: (ts: number | null) => void;
```

关键：**失败时不清空既有数据**。当前 `setProcesses([])` 会清空——改为失败分支不调 `setProcesses`，只 `setError` + `setStaleAt`。

`setProcesses`/`setConnections`/`setPerf` 成功时同步 `setStaleAt(null)`（标记新鲜）。

`staleAt` 不持久化（运行时态）。

### 3.5 UI（陈旧标注）

在三个面板的 header 副信息区（`ProcessPanel.tsx:186`、`PortRadar` header、`PerfPanel` header）：

- `staleAt !== null` 时显示「⚠ 数据陈旧（上次成功 {相对时间}）」。
- `format.ts` 现有 `formatDuration(ms)` 但**无相对时间函数**。新增 `formatRelativeTime(fromMs, nowMs=Date.now())`：差值 < 60s 显示"N 秒前"，否则复用 `formatDuration` 的分/时粒度。纯函数，TDD。

不整屏替换——错误横幅 + 陈旧标注，与 A1 的 `showErrorBanner` 逻辑一致（`ProcessPanel.tsx:173`）。

---

## 4. 测试策略

### 4.1 main handler（需新测试文件或扩展）

main 目前无单元测试（CHANGELOG 承认 main handler 仅人工验收）。A2 引入结构化结果后，**main 的失败转换逻辑值得测试**，但 main 依赖 Electron `ipcMain` 难以纯单元化。

**决策：不新增 main 单元测试**（与现状一致，main handler 改动由 hook 集成测试覆盖）。理由：mock `ipcMain.handle` + native addon 的成本高于收益；main 的逻辑极简（try/catch 包裹 + 赋值），出错面小。

### 4.2 hook 行为（关键，扩展或新建）

新建 `app/tests/useCollectResult.test.ts`（或扩展各 store 测试），用 mock ipc 返回 `{ ok: false, ... }`，断言：
- 失败时 store 的 processes/connections/perf **未被清空**（保留旧值）。
- 失败时 `error` 被设置，`staleAt` 被设为 `lastSuccessAt`。
- 成功但空数组时 `staleAt === null`，数据为空（非错误）。
- 成功后 `staleAt` 重置为 null。

### 4.3 store 测试（扩展）

`processPanelStore.test.ts` / `portRadarStore.test.ts` / `perfStore.test.ts`：
- 新增 `staleAt` 字段的 set/get 测试。
- `setProcesses` 后 `staleAt === null`。

### 4.4 mock 同步（`app/tests/setup.ts`）

`mockIpc` 的三个轮询方法默认返回**成功空结果**：

```ts
fetchProcesses: vi.fn(() => Promise.resolve({ ok: true, data: [], sampledAt: Date.now() })),
fetchConnections: vi.fn(() => Promise.resolve({ ok: true, data: [], sampledAt: Date.now() })),
fetchPerf: vi.fn(() => Promise.resolve({ ok: true, data: null, sampledAt: Date.now() })),
```

注意：现有 mock 用 `Partial<...>` 且不完整（缺多个方法）——A2 顺势把三个轮询方法的 mock 形状对齐 `CollectResult`。其它缺失方法不在本 spec 补（避免范围蔓延）。

---

## 5. 向后兼容与迁移

- **IPC 通道名不变**（`proc:fetchProcesses` 等），仅返回值形状变。
- preload 透传，无版本协商。**假设 main 与 renderer 同版本**（Electron 单体应用，无跨版本 IPC）。无需迁移。
- localStorage 持久化的 store 字段（filter/sortKey/pollMs 等）不变；`staleAt`/`error` 不持久化。

---

## 6. 风险与回滚

- **风险：中低**。跨 main→preload→hook→store→UI 五层，但每层改动机械（解构 CollectResult）。最大风险是漏改某个消费点导致 `result.data` undefined。
- **缓解**：TS strict + ExposedApi 类型签名强制对齐；typecheck 会捕获未解构的消费者。
- **回滚**：纯 TS 改动，单/多 commit 可回退；无 native/IPC 通道变更。

---

## 7. 路线衔接

- A2 让采集状态**可信**——这是 D（诊断导出）的前置：诊断包要能报告"采集器状态：OK / FAIL(code)"。
- A2 的 `CollectResult` 形状是后续 IPC 结构化的范式（按需通道若需要也可 Adopt，但本 spec 不强制）。
