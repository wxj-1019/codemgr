# 两进程环境变量对比（Env Diff）设计

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 四-5

## 1. 问题

两个"看起来一样"的 node 进程，一个能连库一个不能——八成是继承的环境变量不同。现有能力只能逐个进程查看 env（详情侧栏按需加载），对比只能靠肉眼来回翻，几百个键里找几个差异不现实。

## 2. 目标 / 非目标

**目标**
- 进程面板选中**恰好 2 个**进程时，出现「对比环境变量」入口，弹出对话框展示三组差异：仅 A 有 / 仅 B 有 / 值不同。
- Windows env 键**大小写不敏感**比较（`PATH` ≡ `Path`），显示保留原大小写。
- 复用按需通道 `proc:fetchEnv`（不进热路径，符合 §7-10 约束）。

**非目标（YAGNI）**
- 三进程及以上对比、值内 diff（PATH 分段对比）、导出 diff 结果。
- env 编辑/注入（只读诊断工具，不做写操作）。

## 3. 设计

### 3.1 纯逻辑（`app/src/lib/envDiff.ts`，TDD）

```ts
interface EnvChange { key: string; aVal: string; bVal: string }
interface EnvDiffResult {
  added: string[];      // 仅 B 有（key 取 B 的大小写）
  removed: string[];    // 仅 A 有（key 取 A 的大小写）
  changed: EnvChange[]; // 两边都有、值不同（key 取 A 的大小写）
  sameCount: number;    // 键值全同的数量（footer 展示「相同 N 个」）
}
```
`diffEnv(a, b)`：键按小写归一比较；输出数组按小写键排序（稳定可读）。

### 3.2 UI（`app/src/components/EnvDiffDialog.tsx`）

- 基于 ui/Dialog（portal + focus trap + Esc），标题含两进程 `name (PID)` 与 A/B 标注。
- 打开时并行 `ipc.fetchProcessEnv(pidA/pidB)`，三态：loading / error（任一返回 null → 「读取失败：权限不足或进程已退出」）/ done。
- 内容三区：值不同（`key` + A值 → B值，等宽 break-all）、仅 A 有、仅 B 有；footer 显示 sameCount。空区显示「无」。

### 3.3 入口（ProcessPanel）

- secondaryActions 区：`selectedPids.size === 2` 时显示「对比环境变量」按钮。
- 点击把两个 pid 的 ProcessInfo 快照进本地 state（`{a, b} | null`），渲染 `<EnvDiffDialog a b onClose />`——对话框存活期间选择变化不影响已打开对比。

## 4. 测试（TDD）

- `envDiff.test.ts`：added/removed/changed/sameCount 全路径；键大小写不敏感（`Path` vs `PATH` 视为同键，changed 显示 A 的大小写）；空 env；排序稳定。
- 既有测试不回归。

## 5. 验收（人工）

1. 选中两个 node 进程 → 对比 → 列出 PORT/PATH 差异。
2. 选中系统进程（env 读取无权限）→ 错误提示而非白屏。
