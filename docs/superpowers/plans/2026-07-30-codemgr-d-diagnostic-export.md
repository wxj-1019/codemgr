# CodeMgr D — 诊断上下文导出 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 进程详情侧栏一键复制脱敏 Markdown 诊断上下文（进程身份/cwd/Git/端口/资源/父链/环境变量 key），便于粘贴给 AI 助手排障。

**Architecture:** 纯函数 `buildDiagnostic` + `maskEnvVars`（TDD）做聚合与脱敏；侧栏按钮按需补齐缺失数据（cwd/Git/env），生成后弹预览窗，确认复制到剪贴板。纯渲染层，无 IPC/native 改动。

**Tech Stack:** React 18 + TypeScript + Vitest。复用 format.ts（formatDuration/formatRelativeTime）、portFilter.ts（isListenLike）、既有按需 IPC。

**上游 Spec:** `docs/superpowers/specs/2026-07-30-codemgr-d-diagnostic-export.md`

**分支:** `docs/a1-bugfix-spec`（沿用）。

---

## 文件结构

| 改动 | 文件 | 职责 |
|------|------|------|
| 新建纯函数 | `app/src/lib/diagnostic.ts` | `buildDiagnostic(input)` 聚合 Markdown + `maskEnvVars` 脱敏 |
| 新建组件 | `app/src/components/DiagnosticPreview.tsx` | 预览弹窗（`<pre>` + 复制/关闭） |
| 改组件 | `app/src/components/ProcessDetailSidebar.tsx` | "复制诊断上下文"按钮 + 聚合流程 |
| 测试 | `app/tests/diagnostic.test.ts`（新建） | 纯函数 TDD |

---

## Task 1: maskEnvVars + buildDiagnostic 纯函数（TDD）

**Files:**
- Create: `app/src/lib/diagnostic.ts`
- Test: `app/tests/diagnostic.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `app/tests/diagnostic.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { maskEnvVars, buildDiagnostic } from '../src/lib/diagnostic';
import type { ProcessInfo, NetConnection, GitIdentity } from '../electron/ipc-types';

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 100, ppid: 50, name: 'node.exe', cmdline: 'vite --host', cwd: 'E:\\repo\\app',
  kernelTimeMs: 1000, userTimeMs: 2000, workingSetBytes: 186 * 1024 * 1024,
  createTimeMs: Date.now() - 600000, threadCount: 12, handleCount: 340, ...over,
});

describe('maskEnvVars', () => {
  it('masks all values, never leaks original', () => {
    const masked = maskEnvVars({ PATH: '/usr/bin', NODE_ENV: 'development', API_KEY: 'sk-12345' });
    const map = new Map(masked);
    expect(map.get('NODE_ENV')).toBe('***');
    expect(map.get('API_KEY')).toBe('[REDACTED]');
    // 原值绝不出现
    expect(masked.some(([, v]) => v.includes('development') || v.includes('sk-12345'))).toBe(false);
  });

  it('marks sensitive keys (token/secret/password/key/auth/cookie) as [REDACTED]', () => {
    const masked = maskEnvVars({
      TOKEN: 'x', MY_SECRET: 'x', PASSWORD: 'x', DB_KEY: 'x', AUTH: 'x', COOKIE: 'x', API_KEY: 'x',
    });
    for (const [, v] of masked) expect(v).toBe('[REDACTED]');
  });

  it('marks ordinary keys as ***', () => {
    const masked = maskEnvVars({ PATH: '/usr/bin', HOME: '/home', PORT: '3000' });
    for (const [, v] of masked) expect(v).toBe('***');
  });

  it('sorts keys alphabetically', () => {
    const masked = maskEnvVars({ ZEBRA: '1', ALPHA: '2', MIKE: '3' });
    expect(masked.map(([k]) => k)).toEqual(['ALPHA', 'MIKE', 'ZEBRA']);
  });
});

describe('buildDiagnostic', () => {
  const baseInput = {
    proc: proc(),
    cpuPercent: 2.3,
    preciseCwd: 'E:\\repo\\app',
    gitIdentity: { gitRoot: 'E:/repo', commonDir: 'E:/repo/.git', branch: 'feat/login', head: 'refs/heads/feat/login', detached: false, isWorktree: false } as GitIdentity,
    envVars: { PATH: '/bin', NODE_ENV: 'dev', API_KEY: 'secret' },
    connections: [
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 5173, remoteAddr: '', remotePort: 0, state: 'LISTEN', pid: 100, processName: 'node.exe' },
    ] as NetConnection[],
    parentChain: [proc({ pid: 50, ppid: 40, name: 'codex.exe' }), proc({ pid: 40, ppid: 30, name: 'explorer.exe' })],
    staleAt: null,
    codeMgrVersion: '2.3',
  };

  it('includes all sections', () => {
    const out = buildDiagnostic(baseInput);
    expect(out).toContain('node.exe');
    expect(out).toContain('PID 100');
    expect(out).toContain('vite --host');
    expect(out).toContain('feat/login');
    expect(out).toContain('5173');
    expect(out).toContain('codex.exe');
    expect(out).toContain('API_KEY=[REDACTED]');
  });

  it('shows non-git when gitIdentity is null', () => {
    const out = buildDiagnostic({ ...baseInput, gitIdentity: null });
    expect(out).toContain('非 Git 仓库');
  });

  it('omits Git section when gitIdentity undefined (not resolved)', () => {
    const out = buildDiagnostic({ ...baseInput, gitIdentity: undefined });
    expect(out.match(/## Git/)).toBeNull();
  });

  it('shows env as "(未读取)" when envVars is null', () => {
    const out = buildDiagnostic({ ...baseInput, envVars: null });
    expect(out).toContain('（未读取）');
  });

  it('shows "无" when no listening ports', () => {
    const out = buildDiagnostic({ ...baseInput, connections: [] });
    expect(out).toContain('无监听端口');
  });

  it('marks stale data when staleAt set', () => {
    const out = buildDiagnostic({ ...baseInput, staleAt: Date.now() - 30000 });
    expect(out).toContain('陈旧');
  });

  it('never leaks env original values', () => {
    const out = buildDiagnostic(baseInput);
    expect(out).not.toContain('secret');
    expect(out).not.toContain('/bin');
    expect(out).not.toContain('development');
  });
});
```

- [ ] **Step 2: 运行测试，确认红**

Run: `cd app && pnpm vitest run tests/diagnostic.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 diagnostic.ts**

新建 `app/src/lib/diagnostic.ts`：

```ts
import type { ProcessInfo, GitIdentity, NetConnection } from '../../electron/ipc-types';
import { formatDuration, formatRelativeTime } from './format';
import { isListenLike } from './portFilter';

const SENSITIVE_KEY_RE = /(token|secret|password|passwd|key|credential|auth|cookie|api[-_]?key)/i;

/**
 * 环境变量脱敏（D）。所有 value 掩码，永不输出原值。
 * 敏感 key（token/secret/password/key/auth/cookie…）→ [REDACTED]；其余 → ***。
 * 返回排序后的 [key, masked] 数组（key 全保留，诊断价值在 key 名）。
 */
export function maskEnvVars(env: Record<string, string>): Array<[string, string]> {
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k]) => [k, SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : '***']);
}

export interface DiagnosticInput {
  proc: ProcessInfo;
  cpuPercent: number;
  preciseCwd: string | null;
  gitIdentity: GitIdentity | null | undefined;
  envVars: Record<string, string> | null;
  connections: NetConnection[];
  parentChain: ProcessInfo[];
  staleAt: number | null;
  codeMgrVersion: string;
}

/**
 * 聚合进程诊断上下文为 Markdown（D）。纯函数，无副作用。
 * 环境变量值统一脱敏（见 maskEnvVars）。详见 spec §2.3。
 */
export function buildDiagnostic(input: DiagnosticInput): string {
  const { proc, cpuPercent, preciseCwd, gitIdentity, envVars, connections, parentChain, staleAt, codeMgrVersion } = input;
  const now = new Date();
  const lines: string[] = [];

  lines.push('# CodeMgr 进程诊断');
  lines.push('');
  lines.push(`**进程**: ${proc.name} (PID ${proc.pid})`);
  lines.push(`**生成时间**: ${now.toLocaleString()}`);
  const dataState = staleAt !== null ? `陈旧（上次成功 ${formatRelativeTime(staleAt)})` : '新鲜';
  lines.push(`**数据状态**: ${dataState}`);
  lines.push('');

  // 基本信息
  lines.push('## 基本信息');
  lines.push(`- 名称: ${proc.name}`);
  lines.push(`- PID: ${proc.pid}`);
  lines.push(`- 父进程 PID: ${proc.ppid}`);
  lines.push(`- 创建时间: ${new Date(proc.createTimeMs).toLocaleString()}`);
  lines.push(`- 运行时长: ${formatDuration(Date.now() - proc.createTimeMs)}`);
  lines.push(`- 命令行: ${proc.cmdline || '—'}`);
  lines.push(`- 工作目录: ${preciseCwd || proc.cwd || '—'}`);
  lines.push('');

  // Git（仅当已解析：null=非 git 也显示，undefined=未解析则省略）
  if (gitIdentity !== undefined) {
    lines.push('## Git');
    if (gitIdentity === null) {
      lines.push('- 非 Git 仓库');
    } else {
      lines.push(`- 分支: ${gitIdentity.detached ? '(detached)' : gitIdentity.branch ?? '—'}`);
      lines.push(`- 仓库根: ${gitIdentity.gitRoot}`);
      lines.push(`- HEAD: ${gitIdentity.head}`);
      if (gitIdentity.isWorktree) lines.push('- (linked worktree)');
    }
    lines.push('');
  }

  // 资源
  lines.push('## 资源');
  lines.push(`- CPU: ${cpuPercent.toFixed(1)}%`);
  lines.push(`- 内存: ${(proc.workingSetBytes / 1048576).toFixed(1)} MB`);
  lines.push(`- 线程: ${proc.threadCount}`);
  lines.push(`- 句柄: ${proc.handleCount}`);
  lines.push('');

  // 监听端口
  const myPorts = connections.filter((c) => c.pid === proc.pid && isListenLike(c));
  lines.push('## 监听端口');
  if (myPorts.length === 0) {
    lines.push('- 无监听端口');
  } else {
    for (const c of myPorts) {
      lines.push(`- ${c.protocol.toUpperCase()} ${c.localAddr}:${c.localPort} (${c.state})`);
    }
  }
  lines.push('');

  // 父进程链
  lines.push('## 父进程链');
  if (parentChain.length === 0) {
    lines.push('- 无');
  } else {
    parentChain.forEach((p, i) => {
      const indent = '  '.repeat(i) + (i > 0 ? '└─ ' : '');
      lines.push(`${indent}${p.name} (PID ${p.pid})`);
    });
  }
  lines.push('');

  // 环境变量
  lines.push('## 环境变量');
  if (envVars === null) {
    lines.push('- （未读取）');
  } else {
    const masked = maskEnvVars(envVars);
    lines.push(`共 ${masked.length} 项:`);
    lines.push(masked.map(([k, v]) => `${k}=${v}`).join(', '));
  }
  lines.push('');

  lines.push('---');
  lines.push(`由 CodeMgr v${codeMgrVersion} 生成`);
  return lines.join('\n');
}
```

- [ ] **Step 4: 运行测试，确认绿**

Run: `cd app && pnpm vitest run tests/diagnostic.test.ts`
Expected: PASS —— 全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/diagnostic.ts app/tests/diagnostic.test.ts
git commit -m "feat(app): buildDiagnostic + maskEnvVars pure functions (D)

Aggregates process context into redacted Markdown. Env values always masked
(sensitive keys [REDACTED]); original values never appear in output."
```

---

## Task 2: DiagnosticPreview 预览弹窗组件

**Files:**
- Create: `app/src/components/DiagnosticPreview.tsx`

- [ ] **Step 1: 实现预览弹窗**

新建 `app/src/components/DiagnosticPreview.tsx`：

```tsx
import { useEffect, useRef } from 'react';

// 诊断上下文预览弹窗（D）。显示脱敏后的 Markdown，提供复制/关闭。
// 简单模态：Escape 关闭，初始焦点在复制按钮。复制用 navigator.clipboard。
export function DiagnosticPreview({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  const copyBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    copyBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onClose();  // 复制成功后关闭
    } catch {
      // clipboard 被阻断：留在弹窗让用户手动选中复制
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-base-600 bg-base-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-base-600 px-4 py-3">
          <h3 className="text-sm font-semibold text-fg-primary">诊断上下文（已脱敏）</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-primary" aria-label="关闭">✕</button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-xs text-fg-secondary whitespace-pre-wrap break-all font-mono">
          {text}
        </pre>
        <div className="flex justify-end gap-2 border-t border-base-600 p-3">
          <button
            ref={copyBtnRef}
            onClick={copy}
            className="rounded bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent/80"
          >
            复制到剪贴板
          </button>
          <button
            onClick={onClose}
            className="rounded border border-base-600 px-4 py-1.5 text-sm text-fg-secondary hover:bg-base-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/src/components/DiagnosticPreview.tsx
git commit -m "feat(app): DiagnosticPreview modal component (D)"
```

---

## Task 3: 侧栏集成（按钮 + 聚合流程）

**Files:**
- Modify: `app/src/components/ProcessDetailSidebar.tsx`

- [ ] **Step 1: import + state**

`app/src/components/ProcessDetailSidebar.tsx` 顶部 import 加：

```tsx
import { buildDiagnostic } from '../lib/diagnostic';
import { DiagnosticPreview } from './DiagnosticPreview';
import { usePortRadarStore } from '../store/portRadarStore';
```

store 解构区（:17 附近）加 portRadarStore 读取（端口数据）：

```tsx
  const connections = usePortRadarStore((s) => s.connections);
```

组件内（gitState state 附近）加诊断 state：

```tsx
  const [diagState, setDiagState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [diagText, setDiagText] = useState<string | null>(null);
  const cpuPercent = cpuMap[proc?.pid ?? -1] || 0;  // 当前进程 CPU（proc 在按钮渲染时已就绪）
```

（注意：`cpuMap` 需从 store 解构——检查现有解构是否已含，若无则加。）

- [ ] **Step 2: copyDiagnostic 函数**

在 loadGitIdentity 之后加：

```tsx
  async function copyDiagnostic() {
    if (pid == null) return;
    setDiagState('loading');
    try {
      const p = processes.find((x) => x.pid === pid)!;
      // 按需补齐：精确 cwd
      let cwd = preciseCwdByPid[pid] ?? null;
      if (!cwd) {
        const precise = await ipc.fetchCwd(pid);
        if (pidRef.current !== pid) return;
        cwd = precise;
        if (cwd) setStoreCwd(pid, cwd);
      }
      // Git 身份
      let git = gitIdentityByPid[pid];
      if (git === undefined && cwd) {
        git = await ipc.fetchGitIdentity(cwd);
        if (pidRef.current !== pid) return;
        setGitIdentity(pid, git);
      }
      // 环境变量
      let env = envVars;
      if (env === null) {
        env = await ipc.fetchProcessEnv(pid);
        if (pidRef.current !== pid) return;
      }
      // 父进程链（3 层）
      const chain: typeof processes = [];
      let curPpid = p.ppid;
      for (let i = 0; i < 3 && curPpid > 0; i++) {
        const parent = processes.find((x) => x.pid === curPpid);
        if (!parent) break;
        chain.push(parent);
        curPpid = parent.ppid;
      }
      const text = buildDiagnostic({
        proc: p,
        cpuPercent: cpuMap[pid] || 0,
        preciseCwd: cwd,
        gitIdentity: git,
        envVars: env,
        connections,
        parentChain: chain,
        staleAt: null,  // 诊断时刻取当前；staleAt 由面板 header 标注
        codeMgrVersion: '',
      });
      if (pidRef.current !== pid) return;
      setDiagText(text);
      setDiagState('idle');
    } catch {
      if (pidRef.current !== pid) return;
      setDiagState('error');
    }
  }
```

注意：`codeMgrVersion` 留空（侧栏无版本；可从 App.tsx 传或省略——首版留空，footer 显示 "CodeMgr v"）。若需版本，从 `useProcessPanelStore` 无此字段——**决策：footer 不带版本号**（避免引入额外 IPC/prop），只显示 "由 CodeMgr 生成"。

修正 buildDiagnostic 调用：`codeMgrVersion: ''`，并接受 footer 无版本。

- [ ] **Step 3: 按钮渲染**

在侧栏底部操作区（"结束进程"按钮之上，`<div className="border-t border-base-600 p-3">` 内）加：

```tsx
        <button
          onClick={copyDiagnostic}
          disabled={diagState === 'loading'}
          className="mb-2 w-full rounded border border-base-600 px-3 py-1.5 text-sm text-fg-secondary hover:bg-base-700 disabled:opacity-50"
        >
          {diagState === 'loading' ? '生成中…' : '复制诊断上下文'}
        </button>
        {diagState === 'error' && (
          <p className="mb-2 text-xs text-red-400">生成失败</p>
        )}
```

并在组件 return 的 `</aside>` 之前（最末）加预览弹窗：

```tsx
      {diagText && <DiagnosticPreview text={diagText} onClose={() => setDiagText(null)} />}
```

（注意：弹窗需在 `</aside>` 外或内？aside 是 `hidden lg:flex`，弹窗 `fixed` 不受影响——放 aside 内最末即可。）

- [ ] **Step 4: typecheck**

Run: `cd app && pnpm typecheck`
Expected: PASS。注意 `cpuMap` 需在 store 解构中（现有解构 `processes, selectedPids, procHistory, preciseCwdByPid, ...`——检查是否含 cpuMap，若无加 `cpuMap`）。

- [ ] **Step 5: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ProcessDetailSidebar.tsx
git commit -m "feat(app): copy diagnostic context button in detail sidebar (D)

One-click aggregates process identity/cwd/Git/ports/resources/parent-chain/
env-keys into redacted Markdown, previews in a modal, copies to clipboard on
confirm. Cascades on-demand resolution of cwd/Git/env if not yet cached."
```

---

## Task 4: 全量验收

- [ ] **Step 1: 全量测试**

Run: `cd app && pnpm vitest run`
Expected: PASS（含新增 diagnostic ~12 用例）。

- [ ] **Step 2: typecheck**

Run: `cd app && pnpm typecheck`
Expected: exit 0。

- [ ] **Step 3: 确认无 native/IPC 通道改动**

Run: `git diff <d-spec-commit>..HEAD --stat -- codemgr-native app/electron`
Expected: 空（无 native/electron handler 改动；D 是纯渲染层）。

- [ ] **Step 4: 更新 AGENTS.md §8**

用实际测试数更新。

- [ ] **Step 5: Commit 文档**

```bash
git add AGENTS.md
git commit -m "docs: update test count after D diagnostic export"
```

- [ ] **Step 6: 人工验收（记 PR）**

选一个进程 → 侧栏"复制诊断上下文" → 预览弹窗显示脱敏 Markdown → "复制到剪贴板" → 粘贴到文本编辑器验证：含进程/Git/端口/父链，环境变量值全为 `***`/`[REDACTED]`，无原值泄露。
