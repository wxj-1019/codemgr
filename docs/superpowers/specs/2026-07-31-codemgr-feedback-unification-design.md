# 操作反馈通道统一 + 合并后一致性收尾（v2.4 发布准备）

日期：2026-07-31
状态：已批准（方向 A：全量收敛到 toast）
关联：`2026-07-31-codemgr-ux-audit.md`（UX-01/03/07/17 起源）、dev-experience-pack（toast 系统起源）

---

## 1. 背景

`feat/desktop-workbench` 收敛合并后，应用存在两套并行开发各自验收的操作反馈机制：

| 通道 | 形式 | 来源 | 现状 |
|------|------|------|------|
| inline notice（`useNotice` + `PanelAlert`） | 面板顶部横幅，4s 自动消失 | workbench 轨道（UX-01/03/07/17） | 38 处调用，8 个组件 |
| toast（`toastStore` + `ToastHost`） | 右下角堆叠，分级时长，可手动关闭 | main 轨道（dev-experience-pack） | 11 处调用 |

后合并审计发现 3 个问题：

1. **BUG：`ToastHost` 双挂载**。`src/main.tsx` 与 `src/App.tsx` 各渲染一次 `<ToastHost />`，生产环境每次 toast 渲染两套（右上角双份堆叠）。
2. **反馈通道双轨**。同类面板内操作反馈位置不一致：kill/复制/拍快照结果 → 面板内横幅；导出/服务跃迁 → 右下角 toast。用户需要习惯两个反馈位置。
3. **文档滞后**。CHANGELOG 的 dev-experience-pack 变更仍在 `[Unreleased]`，未并入 v2.4；AGENTS.md §8 测试数仍为 509（实际 app 594 + native 51）。

## 2. 决策

**统一到 toast，删除 inline notice 通道。**

理由：
- toast 系统能力更完整：堆叠上限 5、分级时长（success/info/warning 4s、error 8s）、手动关闭、`role="status"|"alert"` ARIA、跨面板可见。
- 单一通道规则最简单：所有操作反馈都在右下角，用户只认一个位置。
- 面板内横幅挤占内容区，多面板窄 tile 下尤其明显。
- toast 是 main 轨道（官方验收方向）的资产，反向迁移代价更高。

**保留 `PanelAlert`**，仅服务**常驻错误/警告**（如加载失败 loadError）——这类不消失的上下文错误横幅语义与临时操作反馈不同，不属于本次统一范围。

## 3. 改动设计

### 3.1 toastStore：新增 `warning` kind

`ToastKind = 'success' | 'error' | 'info' | 'warning'`

- 图标：`TriangleAlert`（lucide），色：`text-warn`，accent 条 `bg-warn`。
- 时长：warning 与 info 同为 4s（非致命但需注意）。
- `ToastHost.KIND_META` 补 warning 映射。
- 现有调用不变（push API 兼容）。

### 3.2 调用迁移（38 处 → notify.*）

| 原 tone | 迁移目标 | 场景 |
|---------|---------|------|
| `danger`（28） | `notify.error` | kill 失败/未结束、快照失败、启动/停止/重启/删除失败、复制失败、名称未填 |
| `success`（5） | `notify.success` | kill 成功、快照杀进程成功 |
| `warning`（4） | `notify.warning`（新） | kill 部分成功（killed/targets）、UX-09 面板满员替换告知（App.tsx） |

涉及文件与调用数：
- `ProcessPanel.tsx`（15）：单杀/批量/分组/组内/killByName/killTree 结果
- `SnapshotPanel.tsx`（7）：快照名称校验、拍快照失败、快照内 kill
- `RunProfilesPanel.tsx`（7）：启动/停止/重启/删除反馈
- `PortRadar.tsx`（3）：kill
- `SessionPanel.tsx`（2）：停止会话
- `App.tsx`（1）：UX-09 活跃 tile 被替换的告知
- `ProcessTable.tsx`（1）、`ProjectGroupView.tsx`（1）：复制失败

（迁移前以 `grep -rn "showNotice(" src/` 实数为准，上述为审计快照。）

迁移后删除：
- `src/hooks/useNotice.ts`
- 各组件中 `notice`/`showNotice` 引用与 `{notice && <PanelAlert ...>}` 渲染块
- `src/App.tsx` 的 `useNotice` 引用（UX-09 改为 `notify.warning`）
- `tests/useNotice.test.tsx`

`RunProfilesPanel` 的 `{loadError && <PanelAlert tone="danger">...}` **保留**（常驻错误）。

### 3.3 ToastHost 单挂载

删除 `src/App.tsx` 中的 `<ToastHost />`，保留 `src/main.tsx`（ErrorBoundary 内，崩溃时 toast 仍可用）。

### 3.4 测试更新

| 文件 | 改动 |
|------|------|
| `tests/useNotice.test.tsx` | 删除 |
| `tests/processPanelMultiSelect.test.tsx` | render 加 `<ToastHost />`（toast 经 portal 渲染到 body，测试树需挂载宿主才能找到文本） |
| `tests/portRadar.test.tsx` | 同上 |
| `tests/runProfilesPanel.test.tsx` | 同上 |
| `tests/snapshotPanelResponsive.test.tsx` | 同上 |
| `tests/sessionPanel.test.tsx` | 同上 |
| `tests/toastHost.test.tsx` | 补 warning kind 用例（图标/色/时长） |

断言文本本身不变（`findByText('已结束 …')` 等），仅渲染宿主变化。

### 3.5 文档收尾

- `CHANGELOG.md`：dev-experience-pack 内容并入 `[v2.4]` 节，新增本次「反馈通道统一」条目；`[Unreleased]` 清空。
- `AGENTS.md` §8：测试数更新（app 594 + native 51），v2.4 描述补 dev-experience-pack 与反馈统一。

## 4. 测试策略

- toastStore：warning kind push/时长/上限 回归（已有用例扩展）。
- 面板迁移：既有面板测试在挂 ToastHost 后全部通过 = 迁移正确性证明（同一文本断言、不同宿主）。
- 删除 useNotice 后 `grep -rn "useNotice" src/` 为零。
- 全量：`cd app && pnpm vitest run` + `pnpm typecheck`；native 未动无需重编。

## 5. 不做的事

- 不迁移常驻错误横幅（loadError 类）——保留 PanelAlert 语义。
- 不改 toast 视觉样式（Aurora 玻璃已验收）。
- 不引入新的反馈形式（如 sound/notification 弹窗）。

## 6. 验收清单

- [ ] 生产构建后任意操作只出现一套 toast
- [ ] kill 部分成功显示 warning 样式 toast
- [ ] 启动失败/删除失败等错误反馈与导出反馈同位置（右下角）
- [ ] `grep -rn "useNotice" app/src/` 为空
- [ ] app 594+ 测试全绿（迁移后计数可能因删 useNotice 测试略降）
- [ ] CHANGELOG v2.4 节完整、Unreleased 为空
