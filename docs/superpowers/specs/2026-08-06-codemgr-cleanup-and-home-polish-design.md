# 性能优化动作深化 + 首页打磨（Cleanup & Home Polish）

日期：2026-08-06
状态：已批准（方向：一键清理闭环 + 首页细节打磨）
关联：`2026-08-01-codemgr-steward-home-design.md`（首页基础，本迭代在其上）、`2026-07-31-codemgr-feedback-unification-design.md`（反馈模式）、`2026-07-31-codemgr-ux-audit.md`（UX 基线）

---

## 1. 背景

v2.5 首页已落地（评估横幅/五卡/问题清单/快速动作），但存在两个缺口：

1. **优化动作未闭环**：快速动作只做"定位"（打开进程面板并选中），没有真正的"优化动作"——用户看到问题后仍需手动到进程面板操作。
2. **首页细节待打磨**：终审遗留的失败态兜底（#2：自驱采样持续失败时首页永久"数据采集中"）与若干信息密度问题（卡片无趋势、磁盘无盘符、无陈旧提示、空态无正向反馈）。

## 2. 决策

- **Track A**：一键清理对话框——`cleanupScanner` 纯函数（候选解析）+ `CleanupDialog`（清单确认）+ 首页「一键优化」入口。安全边界：仅列检测引擎目标与大内存进程，保护名单由 native `IsProtected` 兜底（killByPids 逐 pid 状态反馈）。
- **Track B**：首页打磨 6 项（失败态/趋势/盘符/陈旧提示/空态/文档措辞）。
- 不做：体检报告页（首页即报告）、启动项耗时建议（无 native 数据）、ProcessPanel 流程改动。

## 3. Track A：一键清理

### 3.1 cleanupScanner（纯函数，TDD）

`app/src/lib/cleanupScanner.ts`：

```ts
export type CleanupReason = 'issue-target' | 'large-memory';

export interface CleanupCandidate {
  pid: number;
  name: string;
  reason: CleanupReason;
  cpuPercent: number;   // 0-100 相对单核（cpuMap 取值，缺省 0）
  memoryBytes: number;  // workingSetBytes
}
```

输入：`{ processes: ProcessInfo[], cpuMap: Record<pid, number>, issues: Issue[], largeMemoryBytes?: number }`

规则（按优先级，去重后合并）：
1. **issue-target**：issues 中 `rule === 'process-cpu' | 'memory-growth'` 的 `processId`（检测引擎已保证连续轮触发）
2. **large-memory**：`workingSetBytes > largeMemoryBytes`（默认 1.5GB = 1.5 * 1024^3）
3. 输出排序：issue-target 在前，其余按内存降序；上限 15（复用 `KILL_LIST_CAP` 语义，导出常量 `CLEANUP_LIST_CAP = 15`）
4. 候选必须存在于 processes 快照（pid 匹配），issue 中已退出进程剔除
5. 排除：pid 0/4/8（Idle/System/Registry 保留）；最终保护由 native `IsProtected` 在 kill 时兜底（结果反馈展示）

### 3.2 CleanupDialog

`app/src/components/CleanupDialog.tsx`——复用 `Dialog`（`{ open, onOpenChange, title, description?, children }`）：

- 打开时从 stores 取最新快照 → `cleanupScanner` 解析候选
- 清单行：复选框（默认全选）+ name + PID + CPU% + 内存（格式化）+ 理由 Badge（issue-target=警告"检测异常"/large-memory=中性"大内存"）
- 底部：合计「将结束 N 个进程」+ 取消/确认按钮；确认 → `ipc.killByPids(pids)` → 结果 toast（`summarizeKillOutcomes` + `formatKillFailureSummary` 复用，模式照 ProcessPanel 批量 kill）+ 关闭
- busy 态：执行中按钮禁用
- 无候选时：Dialog 内提示「暂无可清理进程」（描述区），确认按钮禁用

### 3.3 首页入口

HomePanel 快速动作区新增「一键优化」按钮（variant="primary" size="sm"）→ 打开 CleanupDialog（组件内 state 持有）。加载态（assessment null）不渲染该按钮（无数据可扫）。

### 3.4 联动与反馈

- killByPids 返回 `KillOutcome[]`（killed/protected/denied/not-found）→ 全部成功 `notify.success('已清理 N 个进程')`；部分失败 `notify.warning('已清理 X/Y 个（…）')`（复用 formatKillFailureSummary 文案）；全部失败 `notify.error`。
- 清理后首页下一 tick 自然刷新（问题消除）。

## 4. Track B：首页打磨

| # | 项 | 实现 |
|---|----|------|
| B1 | **失败态兜底** | `homeStore` 增加 `error: string \| null`：自驱采样连续失败 3 次置 error（成功即清）；首页 `assessment === null && error` → `StateView state="error" title="无法获取系统状态" description={error}` + 重试按钮（`Button` 包在 StateView 外层的 flex 容器，点击 `refresh()`） |
| B2 | **卡片趋势** | CPU/内存卡显示相对上一采样箭头（perfStore.history 末两点比较：↑/↓ + 色 success/danger，无历史或持平不显示） |
| B3 | **磁盘盘符** | 磁盘卡显示剩余最小盘的盘符（如「C: 剩余 9%」）；无磁盘数据「—」 |
| B4 | **陈旧提示** | `perfStore.staleAt` 距今 >5s 时，卡片区顶部提示条「数据陈旧（HH:MM:SS 起）」（复用 PanelAlert info 或手写轻提示，与面板 summary 文案风格一致） |
| B5 | **空态正向反馈** | 无问题时问题区显示 CheckCircle + 「各项指标正常」 |
| B6 | **文档措辞** | spec `2026-08-01-codemgr-steward-home-design.md` §10 ⑤「system:diskUsage 接线完成」→「磁盘数据复用 perf.disks（§5 修订）」 |

## 5. 测试策略

- `cleanupScanner` TDD：issue 目标/大内存阈值/去重/排序/上限 15/已退出剔除/pid 保留排除——全分支
- `CleanupDialog` 渲染测试：候选清单渲染/默认全选/确认调用 killByPids/结果 toast/无候选禁用/关闭
- `HomePanel` 集成：一键优化按钮打开对话框；失败态渲染 + 重试按钮触发 refresh
- `homeStore`：error 置位/清除逻辑测试
- 全量回归：app 627 + 新增，native 51 不变

## 6. 不做的事

- 不做"全清同类进程"激进逻辑（如清所有 node.exe）——仅检测引擎目标 + 大内存
- 不做清理历史/撤销
- 不动 ProcessPanel/ProcessTable 既有 kill 流程
- 不做启动项建议（无耗时数据）

## 7. 验收清单

- [ ] 首页「一键优化」打开对话框，候选含检测异常与大内存进程，默认全选
- [ ] 确认后按 killByPids 执行，结果 toast 区分全成/部分/全败
- [ ] 无候选时对话框提示且确认禁用
- [ ] 自驱采样连续失败 → 首页错误态 + 重试按钮，重试成功恢复
- [ ] CPU/内存卡有趋势箭头，磁盘卡显示盘符，陈旧时提示条
- [ ] 无问题时正向空态
- [ ] spec §10 措辞修正
- [ ] app 全量测试通过（627 + 新增）、typecheck 干净、native 51 不变
