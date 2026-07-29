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
  lines.push(codeMgrVersion ? `由 CodeMgr v${codeMgrVersion} 生成` : '由 CodeMgr 生成');
  return lines.join('\n');
}
