# CodeMgr D — 诊断上下文导出（设计 Spec）

> 版本: v1.0 | 日期: 2026-07-30 | 状态: 设计锁定
> 上游：审查报告产品能力增强方向 D；依赖 A2（采集状态 CollectResult）+ B（GitIdentity）。
> 方法：brainstorming skill（调研 → 决策点全部可从架构推断 → 设计锁定）。
> 产品价值：AI 开发者遇到"5173 启不起来 / 进程异常"时，一键复制脱敏上下文给 Claude/Codex/Aider 排障。这是 CodeMgr 区别于通用监视器的核心差异化。

---

## 0. 背景与价值

当前要排障一个进程问题，用户得手动拼凑信息：PID、命令行、cwd、端口、父进程、CPU/内存……再粘给 AI 助手。这个过程易遗漏、易泄密（token/secret 藏在环境变量里）。

本 spec 新增"复制诊断上下文"：一键把选中进程的相关上下文聚合成 Markdown，**默认脱敏**（环境变量只留 key、敏感值掩码），用户预览后复制到剪贴板。

它复用并收束前两块的成果：
- **B 的 GitIdentity**：诊断包含 `workspace: { gitRoot, branch, head }`。
- **A2 的采集状态**：诊断标注数据新鲜度（staleAt）。
- 按需读取的精确 cwd + 环境变量。

---

## 1. 范围

### 1.1 包含

在进程详情侧栏新增"复制诊断上下文"按钮，点击后：
1. 聚合该进程的所有已采集/可解析上下文。
2. 按需补齐缺失项（精确 cwd、GitIdentity、环境变量）——若尚未解析，诊断时一并拉取。
3. 脱敏处理（环境变量值掩码）。
4. 生成 Markdown 文本。
5. 用户预览（弹窗/内联）→ 确认后复制到剪贴板。

**纯渲染层实现**：聚合逻辑是纯函数（输入各数据源 → 输出 Markdown 字符串），TDD。不新增 IPC 通道（复用既有 fetchCwd/fetchGitIdentity/fetchProcessEnv + store 已有数据）。

### 1.2 受影响文件

| 文件 | 改动 |
|------|------|
| `app/src/lib/diagnostic.ts`（新建） | 纯函数：`buildDiagnostic(input)` 聚合 + 脱敏 + 生成 Markdown；`maskEnvVars()` 脱敏 |
| `app/src/components/ProcessDetailSidebar.tsx` | "复制诊断上下文"按钮 + 预览/复制流程 |
| `app/src/components/DiagnosticPreview.tsx`（新建） | 预览弹窗（Markdown 文本 + 复制按钮） |
| `app/tests/diagnostic.test.ts`（新建） | 纯函数 TDD（脱敏 + 聚合格式） |

### 1.3 明确不做

- **不新增 IPC**。诊断完全在渲染层用 store 既有数据 + 既有按需通道（fetchCwd/fetchGitIdentity/fetchProcessEnv）。
- **不采集 prompt/源码/终端内容**。只聚合进程元信息 + 端口 + Git 身份 + 环境变量 key。
- **不做富文本/HTML 导出**。纯 Markdown 文本，最大化 AI 助手可读性。
- **不自动发送到任何服务**。只复制到剪贴板，用户自行粘贴。
- **不导出全量进程列表**。只针对当前选中进程（+ 其端口 + 父链）。

### 1.4 成功标准

- 选中一个进程 → 点"复制诊断上下文" → 预览脱敏后的 Markdown → 复制到剪贴板。
- 环境变量值被掩码（`SECRET=abc123` → `SECRET=***`），key 保留。
- 敏感 key 名（含 token/secret/password/key/credential/auth/cookie）标记为 `[REDACTED]`。
- 诊断包含：进程身份（pid/name/ppid/createTime）、命令行、cwd（精确优先）、Git 身份（branch/gitRoot）、监听端口、CPU/内存/线程/句柄、父进程链（3 层）、环境变量 key 列表。
- 数据陈旧时标注（复用 staleAt）。
- `cd app && pnpm typecheck` + `pnpm vitest run` 绿。
- 无 native / IPC 通道改动。

---

## 2. 数据模型

### 2.1 诊断输入（纯函数入参）

`app/src/lib/diagnostic.ts`：

```ts
import type { ProcessInfo, GitIdentity, NetConnection } from '../../electron/ipc-types';

export interface DiagnosticInput {
  proc: ProcessInfo;
  cpuPercent: number;              // 来自 cpuMap[pid]
  preciseCwd: string | null;       // preciseCwdByPid[pid] ?? proc.cwd
  gitIdentity: GitIdentity | null | undefined;  // gitIdentityByPid[pid]
  envVars: Record<string, string> | null;       // fetchProcessEnv 结果（已脱敏前）
  connections: NetConnection[];    // 全量端口（内部按 pid 过滤）
  parentChain: ProcessInfo[];      // ppid 向上 3 层（从 processes 构造）
  staleAt: number | null;          // 进程面板陈旧标记
  codeMgrVersion: string;          // 应用版本
}
```

### 2.2 脱敏规则

`maskEnvVars(env: Record<string,string>): Record<string, string>`：

- 所有 value 统一掩码，**永不输出原值**（诊断只需知道"有哪些 key"）。
- **决策：敏感 key 用 `[REDACTED]`，其余用 `***`**。敏感 key（正则 `/(token|secret|password|passwd|key|credential|auth|cookie|api[-_]?key)/i` 命中）标记 `[REDACTED]` 让用户/AI 注意高危项；普通 key 标记 `***`。
- key 全部保留（诊断价值在 key 名，如 PATH/NODE_ENV/PORT 指示运行环境）。

### 2.3 输出格式（Markdown）

```markdown
# CodeMgr 进程诊断

**进程**: node.exe (PID 18420)
**生成时间**: 2026-07-30 15:42:01
**数据状态**: 新鲜 | 陈旧（上次成功 N 秒前）

## 基本信息
- 名称: node.exe
- PID: 18420
- 父进程 PID: 18300
- 创建时间: 2026-07-30 15:30:00
- 运行时长: 12 分 1 秒
- 命令行: vite --host
- 工作目录: E:\repo\app

## Git
- 分支: feat/login
- 仓库根: E:/repo
- HEAD: refs/heads/feat/login

## 资源
- CPU: 2.3%
- 内存: 186.0 MB
- 线程: 12
- 句柄: 340

## 监听端口
- TCP 0.0.0.0:5173 (LISTEN)
- TCP 0.0.0.0:3000 (LISTEN)

## 父进程链
- codex.exe (PID 18300)
  └─ powershell.exe (PID 18200)
     └─ explorer.exe (PID 18100)

## 环境变量 (12 项)
PATH=***, NODE_ENV=***, PORT=***, API_KEY=[REDACTED], SECRET_TOKEN=[REDACTED], ...

---
由 CodeMgr v2.3 生成
```

---

## 3. 纯函数设计（TDD 核心）

`buildDiagnostic(input: DiagnosticInput): string` 纯函数，无副作用，可 TDD。

### 3.1 脱敏

```ts
const SENSITIVE_KEY_RE = /(token|secret|password|passwd|key|credential|auth|cookie|api[-_]?key)/i;

export function maskEnvVars(env: Record<string, string>): Array<[string, string]> {
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, _v]) => [k, SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : '***']);
}
```

注意：`maskEnvVars` 不返回原 value，杜绝任何泄露路径。

### 3.2 父进程链构造

输入 `parentChain: ProcessInfo[]`（由调用方从 `processes` 按 ppid 向上构造，最多 3 层）。纯函数只负责格式化缩进。

### 3.3 端口过滤

```ts
const myPorts = input.connections.filter(c => c.pid === input.proc.pid && isListenLike(c));
```

复用 `app/src/lib/portFilter.ts` 的 `isListenLike`。

### 3.4 时间格式

创建时间/生成时间用 `toLocaleString()`；运行时长复用 `formatDuration`（format.ts）；陈旧用 `formatRelativeTime`（A2）。

---

## 4. 侧栏集成

### 4.1 按钮位置

`ProcessDetailSidebar` 底部操作区（"结束进程"按钮之上）新增"复制诊断上下文"按钮。

### 4.2 流程（async）

```ts
async function copyDiagnostic() {
  setDiagState('loading');
  try {
    // 1. 按需补齐：精确 cwd（若未缓存）
    const cwd = preciseCwdByPid[pid] ?? await ipc.fetchCwd(pid);
    // 2. Git 身份（若未缓存）
    const git = gitIdentityByPid[pid] ?? (cwd ? await ipc.fetchGitIdentity(cwd) : null);
    // 3. 环境变量（若未加载）
    const env = envVars ?? await ipc.fetchProcessEnv(pid);
    // 4. 聚合
    const text = buildDiagnostic({ proc, cpuPercent, preciseCwd: cwd, gitIdentity: git, envVars: env, ... });
    // 5. 预览
    setDiagPreview(text);
    setDiagState('done');
  } catch { setDiagState('error'); }
}
```

### 4.3 预览弹窗（DiagnosticPreview）

- 显示生成的 Markdown 文本（`<pre>` 只读）。
- "复制到剪贴板"按钮（`navigator.clipboard.writeText`）。
- "关闭"按钮。
- 复用既有 ConfirmDialog 的模态基础（focus trap / Escape 关闭）——或简单实现（侧栏已多处用 alert，但诊断需预览故用弹窗）。

---

## 5. 测试策略

### 5.1 纯函数 TDD（`app/tests/diagnostic.test.ts`）

1. `maskEnvVars`：普通 key → `***`，敏感 key（API_KEY/SECRET/token）→ `[REDACTED]`，不泄露原值。
2. `buildDiagnostic`：完整输入 → 输出含所有区块（基本信息/Git/资源/端口/父链/环境变量）。
3. `buildDiagnostic`：gitIdentity 为 null → Git 区块显示"非 Git 仓库"或省略。
4. `buildDiagnostic`：envVars 为 null → 环境变量区块显示"（未读取）"。
5. `buildDiagnostic`：无监听端口 → 端口区块显示"无"。
6. `buildDiagnostic`：staleAt !== null → 数据状态显示陈旧。
7. 敏感值不出现在输出中（grep 断言）。

### 5.2 侧栏（人工验收）

按钮触发、预览弹窗、复制成功——jsdom 难模拟 clipboard，人工验收。

### 5.3 回归

既有测试全绿（纯新增，不改既有逻辑）。

---

## 6. 安全性论证

- **默认脱敏**：环境变量 value 永不进入输出（maskEnvVars 丢弃原值）。
- **敏感 key 强化标记**：`[REDACTED]` 让用户/AI 注意高危项。
- **用户预览**：复制前必须看到完整输出（弹窗预览），无静默复制。
- **不采集 prompt/源码/终端**：只进程元信息。
- **不自动外发**：只写入剪贴板，用户控制粘贴目标。
- 命令行/cwd 可能含路径，但不含秘密（与现有侧栏展示一致，不额外脱敏——若用户命令行含 token 那是另一层问题，预览让用户可见）。

---

## 7. 风险与回滚

- **风险：低**。纯渲染层 + 纯函数，无 IPC/native/热路径改动。
- 最大风险：脱敏遗漏 → 由 maskEnvVars 统一丢弃 value + 测试断言"原值不出现"兜底。
- **回滚**：纯新增文件 + 侧栏按钮，单 commit 可回退。

---

## 8. 路线衔接

- **C（聚焦上下文）**：D 的诊断是"导出当前聚焦进程"，C 的全局聚焦态（focusedPid/workspaceId）会让 D 自动跟随焦点。D 先做不依赖 C（用 selectedPids）。
- **E（AI Session）**：诊断可扩展为"导出整个 session"（聚合 session 所有进程/端口/资源），复用 D 的 buildDiagnostic 框架。
