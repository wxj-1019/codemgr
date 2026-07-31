# 服务守望与就绪跳转（Service Watch & Ready-Browse）设计

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 四-1/四-2

## 1. 问题

F2 已给 RunProfile 提供端口意图（expectedPorts）与健康检测（就绪/启动中/端口冲突/已退出），但两个闭环仍断着：

1. **被动检测**：端口冲突只有盯着面板徽章才能发现。dev server 起不来的典型场景（"你声明的 3000 被另一个 PID 抢了"）应该主动告知。
2. **就绪后无跳转**：服务就绪后开发者下一步必然是开浏览器访问，现在得自己敲 URL。

## 2. 目标 / 非目标

**目标**
- 状态跃迁主动通知：profile 服务变「就绪」→ success toast；变「端口冲突」→ error toast（含端口与占用 PID）。
- 就绪行内一键「在浏览器打开」（复用子项目 A 的 `shell:openExternalUrl`）。
- 通知只发一次/次跃迁，状态不变不重复轰炸。

**非目标（YAGNI）**
- Windows 系统级通知/托盘提醒（toast 足够，面板外监控受 portRadar 轮询可见性约束，不在本期解决）。
- 冲突自动 kill 占用者、toast 内嵌动作按钮。
- https/自定义 host 探测（统一 `http://127.0.0.1:<port>`）。

## 3. 设计

### 3.1 纯逻辑（`app/src/lib/serviceWatch.ts`，TDD）

- `diffServiceEvents(prev: Map<profileId, kind>, next: Map<profileId, { name, status }>) → ServiceWatchEvent[]`
  - 仅当 `kind` 发生跃迁时产出事件：`→listening`（带全部就绪端口）、`→conflict`（带冲突端口 + 占用者 pid 列表）。
  - `starting/exited/no-ports` 不产生事件；kind 不变不产出。
- `browseUrlForService(status) → string | null`：`listening` 且存在非冲突已监听端口 → `http://127.0.0.1:<port>`（取第一个），否则 null。

### 3.2 RunProfilesPanel 集成

- `prevKindsRef` 持有上一轮的 `Map<profileId, kind>`；`useEffect([runs, connections, profiles])` 中对每个有 run 记录的 profile 计算 `resolveServiceStatus`（用最近一次 run，含 exited），diff 后逐事件 `notify.success/error`，最后更新 ref。
- 行内徽章 IIFE 重构为 `const svc = run ? resolveServiceStatus(run, p, connections) : null`（map 体内算一次），徽章与新增的 Globe 按钮共用：svc 为 listening 时显示 Globe IconButton → `openExternalUrlOrNotify(browseUrlForService(svc))`。

## 4. 测试（TDD）

- `serviceWatch.test.ts`：
  - diff：kind 不变无事件；→listening 一次（端口列表正确）；→conflict 一次（端口 + heldBy）；starting/exited/no-ports 无事件；listening→conflict→listening 连续跃迁各发一次。
  - browseUrlForService：listening 取首个非冲突端口；conflict/starting/exited/no-ports → null。
- 既有测试不回归。

## 5. 验收（人工）

1. 启动一个 expectedPort=3000 的 profile，服务监听成功 → 收到「就绪」toast，行内出现 Globe 按钮，点击开浏览器。
2. 另开终端占用 3000 后启动 profile → 收到「端口被占用：:3000（PID xxx）」error toast。
3. 停留在冲突状态 → 不重复弹；解除后再次就绪 → 再弹一次「就绪」。
