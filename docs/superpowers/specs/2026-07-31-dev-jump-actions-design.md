# 开发者跳转动作闭环（Shell Jump Actions）设计

> 2026-07-31 · 状态：已批准（用户审查后授权按优先级全部实施）· 来源：开发者体验审查 P0-2/P0-3

## 1. 问题

开发者用 CodeMgr 定位到进程/项目/端口后，下一步动作几乎必然是"跳出去"：复制路径、打开文件夹、`cd` 到目录开终端、`code <cwd>` 开编辑器、浏览器访问监听端口。当前这些动作全部缺失或半成品：

- 详情侧栏展示 cwd 文本，**无复制按钮**，更无打开动作。
- 进程右键菜单只有 kill + 复制命令行/PID。
- 端口表是"只读"：无右键菜单、无复制、无"在浏览器打开"。
- 项目分组行算出了 dir，却只有"结束本组"一个动作。

闭环断在最后一步 = 用户还得手动复制路径回终端，工具价值被抵消。

## 2. 目标 / 非目标

**目标**
- 进程/项目/端口三个视图都能一键完成最高频跳转：复制路径、打开文件夹、打开终端、打开编辑器、浏览器打开监听端口。
- 所有 shell 动作封在 main（渲染层只传"打开什么"，拿不到也构造不出命令行），延续仓库红线。

**非目标（YAGNI）**
- 可配置编辑器命令（v1 固定 VS Code `code`，失败时明确报错；配置化留作后续）。
- 打开远程/容器内路径、WSL 终端特化。
- 端口协议探测（http vs https 不做嗅探，统一 http）。

## 3. IPC 设计（新增 2 通道）

| 通道 | 载荷 | 返回 | main 校验 |
|---|---|---|---|
| `shell:openTarget` | `{ kind: 'folder' \| 'terminal' \| 'editor', path: string }` | `string`（空串=成功，非空=错误描述，照 `shell.openPath` 语义） | kind 白名单；path 必须绝对路径且 `existsSync` |
| `shell:openExternalUrl` | `url: string` | `string`（同上） | 仅允许 `http:`/`https:` scheme，其余拒绝 |

安全约束：
- main 侧所有 spawn 用参数数组，**无 shell 字符串拼接**；唯一例外是 `code`（Windows 上是 `code.cmd`，必须 `shell:true`），其 path 参数经 Node cmd quoting，且先过绝对路径+存在性校验。
- terminal 动作链：先试 `wt.exe -d <path>`（Windows Terminal），spawn error 时回退 `cmd.exe /c start "" /D <path> cmd.exe`（必有）。
- editor 动作：`spawn('code', [path], { shell:true, detached:true })`，error → 返回"未检测到 VS Code（code 命令不在 PATH）"。
- folder 动作：`shell.openPath(path)`（Explorer）。
- 渲染层只传 kind + path / url，主进程不接受任意可执行名——结构上杜绝渲染层构造任意命令。

接线照 §10.1 食谱 6 处：`ipc-types.ts`（常量+ExposedApi）→ `preload.ts` → `main.ts` → `app/src/lib/ipc.ts`（本功能无 native 层）。

## 4. main 侧实现

新文件 `app/electron/shellActions.ts`：
- `openTarget(kind, path, deps)` → 校验后分发三个动作；`deps` 注入 `spawn/openPath` 便于测试。
- `buildTerminalPlan(path)` / `buildEditorPlan(path)` / `validateTarget(kind, path)` / `isSafeExternalUrl(url)` 纯函数，TDD。
- `openExternalUrl(url)`：`shell.openExternal`，scheme 白名单。

## 5. 渲染层集成（4 个触点）

### 5.1 详情侧栏 cwd 行（ProcessDetailSidebar）
cwd 文本旁加一行紧凑 IconButton：复制 / 打开文件夹 / 终端 / 编辑器。路径取值优先级与 Git 身份解析一致：精确 cwd（`preciseCwdByPid`）→ 启发式 `proc.cwd`；为空则全部禁用。复制走现有 `navigator.clipboard` 范式。

### 5.2 进程右键菜单（ProcessTable + ProjectGroupView 两处同步）
菜单扩展为（导航动作在上，danger 沉底）：
```
打开所在文件夹 / 在终端打开 / 在编辑器打开
─
复制命令行 / 复制 PID / 复制工作目录
─
结束进程 / 结束进程树（danger）
```
打开类动作无 cwd 时禁用。提取纯函数 `buildProcessMenuItems({cwd, cmdline, pid, hasChildren}, handlers)` 到 `app/src/lib/processMenu.ts`，两处调用点共用（消灭两处重复定义的趋势），TDD。

### 5.3 端口表（PortTable）
- 行右键菜单（复用 ContextMenu）：`在浏览器打开`（仅 TCP 监听行）/ `复制端口` / `复制 PID` / `定位到进程` / `─` / `结束进程`(danger)。
- 操作列「结束」按钮旁加 Globe IconButton（仅 TCP 监听行）= 在浏览器打开，让最高频动作一键可达。
- URL 构造纯函数 `browseUrlFor(conn)`：TCP 监听 → `http://127.0.0.1:<port>`（不嗅探 https；`::`/`0.0.0.0` 统一回环）；UDP/非监听 → `null`（禁用）。放 `app/src/lib/portActions.ts`，TDD。菜单构建 `buildPortMenuItems(conn, handlers)` 同文件，TDD。

### 5.4 项目分组行（ProjectGroupView GroupRow）
组行「结束本组」旁加三个 IconButton：打开文件夹 / 终端 / 编辑器，目标 = `dir`；`dir === null`（未分组组）禁用。

## 6. 错误反馈

v1 沿用调用点现有范式（alert），**Toast 化属子项目 B**，B 落地后这些调用点一并迁移，本项目不重复造反馈组件。

## 7. 测试

- `shellActions.test.ts`：validateTarget（kind 白名单/相对路径拒绝/不存在路径拒绝）、buildTerminalPlan（wt 优先 + cmd 回退参数形状）、isSafeExternalUrl（http/https 通过，file:/javascript:/空拒绝）。
- `processMenu.test.ts`：菜单项顺序/禁用逻辑（无 cwd 禁打开三项、无 cmdline 禁复制、pid≤4 禁 kill 树）。
- `portActions.test.ts`：browseUrlFor（tcp listen→URL、udp→null、IPv6/0.0.0.0 回环化）、buildPortMenuItems 禁用逻辑。
- 现有 400 测试不回归。

## 8. 验收（人工）

1. 侧栏对 node 进程：复制 cwd 成功；打开文件夹弹 Explorer；终端落在该目录；编辑器用 VS Code 打开。
2. 端口表对 `:3000` TCP 监听行：右键四个动作可用，Globe 按钮开浏览器到 `http://127.0.0.1:3000`；UDP 行打开项禁用。
3. 项目分组行三个打开按钮生效；未分组组禁用。
