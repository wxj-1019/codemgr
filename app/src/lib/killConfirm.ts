/** 确认框目标清单最多列出的行数，超出折叠为「…及另 N 个进程」。 */
export const KILL_LIST_CAP = 15;

/**
 * 生成 kill 确认框的目标进程清单（名称 + PID，UX-01）。
 * 高危动作必须让用户核对「到底杀谁」；超上限截断并注明余数。
 */
export function formatKillTargets(
  pids: number[],
  nameOf: (pid: number) => string,
  cap = KILL_LIST_CAP,
): string[] {
  const lines = pids.map((pid) => `${nameOf(pid) || '未知'} (PID ${pid})`);
  if (lines.length > cap) {
    return [...lines.slice(0, cap), `…及另 ${lines.length - cap} 个进程`];
  }
  return lines;
}

/** 逐 pid kill 结果计数（UX-02/04）。 */
export interface KillSummary {
  killed: number;
  protected: number;
  denied: number;
  notFound: number;
}

export function summarizeKillOutcomes(outcomes: Array<{ status: string }>): KillSummary {
  const s: KillSummary = { killed: 0, protected: 0, denied: 0, notFound: 0 };
  for (const o of outcomes) {
    if (o.status === 'killed') s.killed++;
    else if (o.status === 'protected') s.protected++;
    else if (o.status === 'denied') s.denied++;
    else s.notFound++;
  }
  return s;
}

/** 失败原因摘要文案（UX-02/04）：只列非零失败项，如「受保护 2 · 权限不足 1」；全成功返回空串。 */
export function formatKillFailureSummary(s: KillSummary): string {
  const parts: string[] = [];
  if (s.protected > 0) parts.push(`受保护 ${s.protected}`);
  if (s.denied > 0) parts.push(`权限不足 ${s.denied}`);
  if (s.notFound > 0) parts.push(`已退出 ${s.notFound}`);
  return parts.join(' · ');
}
