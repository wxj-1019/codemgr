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
