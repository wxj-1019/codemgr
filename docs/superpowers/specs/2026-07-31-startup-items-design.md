# 系统启动项管理（Startup Items）设计

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 四-3

## 1. 问题

总体设计文档的"开发者工具面板"承诺过启动项管理，目前只有 CodeMgr 自己的开机自启开关。开发者机器上启动项越积越多（各种 IDE 助手、更新器、代理工具），System Informer 有但入口深、交互重；CodeMgr 可以给出开发者视角的清爽管理。

## 2. 目标 / 非目标

**目标**
- 新「启动项」面板（workflow 组）：列出三大来源——HKCU Run、HKLM Run 注册表项、当前用户启动文件夹。
- HKCU Run 项与启动文件夹项可**禁用/恢复**（不删数据，可逆）。
- HKLM 项只读展示（禁用需管理员，v1 不做提权，诚实降级）。
- 全部操作经 main 侧白名单路径执行，渲染层只传 item id + 目标状态。

**非目标（YAGNI）**
- 删除启动项（不可逆，不做）、新增启动项、RunOnce/服务/计划任务（SI 的领域）。
- 提权（UAC）流程、64/32 位注册表视图切换（默认 64 位视图）。
- 轮询监控（手动刷新 + 挂载加载）。

## 3. 模型

### 3.1 StartupItem
```ts
interface StartupItem {
  id: string;      // 'hkcu:<valueName>' | 'hklm:<valueName>' | 'folder:<fileName>'
  name: string;    // value 名或文件名
  command: string; // REG_SZ 数据或文件完整路径
  source: 'hkcu-run' | 'hklm-run' | 'startup-folder';
  enabled: boolean;
}
```

### 3.2 禁用模型（可逆）
- **HKCU Run**：把值**搬**到备份键 `HKCU\Software\CodeMgr\DisabledStartup`（备份 value 名 = `hkcu:<原名>`）→ 系统不再启动它，CodeMgr 列其为 disabled；恢复 = 搬回。HKLM 同理尝试时会因权限失败——v1 直接置灰不展示操作。
- **启动文件夹**：重命名 `<file>` → `<file>.codemgr-disabled`（Windows 不执行未知扩展名）；恢复 = 改回。列表同时展示两种后缀。
- 同名冲突（Run 键与备份键都有）：enabled 为准，丢弃 disabled 重复。

### 3.3 采集与执行（main，`app/electron/startupItems.ts`）
- 采集：`reg.exe query <key>`（execFile 无 shell，args 数组）× 3 键（HKCU Run / HKLM Run / 备份键）+ `fs.readdir` 启动文件夹（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`）。单源失败不拖垮整体（该源为空）。
- 解析 `parseRegQueryRun(output)`：4 空格分列，`REG_SZ`/`REG_EXPAND_SZ` 值（纯函数，TDD）。
- 启停计划 `buildTogglePlan(item, enable)`（纯函数，TDD）：返回有序步骤（`reg add/delete` args 数组 或 `rename(from,to)`），执行器逐步执行，任一步失败即返回错误文本。

## 4. IPC（新增 2 通道）

| 通道 | 载荷 | 返回 |
|---|---|---|
| `startup:list` | — | `StartupItem[]` |
| `startup:setEnabled` | `id: string, enabled: boolean` | `string`（''=成功，非空=错误描述） |

## 5. UI

- `startupStore.ts`：items/loading/error/togglingIds + `refresh()`/`toggle(id)`（§10.2 范式，不 persist）。
- `StartupPanel.tsx`：PanelActionBar（摘要 + 刷新）+ 表格（名称/来源 Badge/命令（截断 title 全显）/状态/启停按钮）；HKLM 行操作置灰（title「系统级启动项：需管理员权限，v1 只读」）。LoadState 三态；toggle 失败 `notify.error`。
- 注册：`layoutStore.BuiltInPanelId` 加 `'startup'` + panelCatalog（workflow 组，icon "启"）。

## 6. 测试（TDD）

- `startupItems.test.ts`：parseRegQueryRun（常规/带空格名/跳过非 REG_SZ/空输出）、merge 去重（enabled 优先）、buildTogglePlan（hkcu 禁用/恢复两步顺序与 args、folder rename、hklm 返回空计划）。
- `startupStore.test.ts`：refresh 成功/失败态、toggle 乐观更新 + 失败回滚 + notify。
- 既有测试不回归（panelCatalog 测试若断言面板数需同步）。

## 7. 验收（人工）

1. 面板列出本机启动项，HKCU/文件夹项可禁用，重启后对应程序不再自启；恢复后还原。
2. HKLM 项只读，无操作按钮。
3. 禁用后重启 CodeMgr，状态保持（禁用态在系统侧持久）。
