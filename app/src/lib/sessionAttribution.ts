import type { ProcessInfo } from '../../electron/ipc-types';
import { labelForProcess } from './processLabels';

export interface Session {
  /** Session 身份 = 根进程的 pid:createTimeMs（复用 snapshotIdentity 范式）。 */
  id: string;
  /** 根进程 pid（便于 E2 调 killTree）。 */
  rootPid: number;
  /** 根进程的 label kind（'ai' | 'ai-ide'，或注入种子的标记）。 */
  kind: string;
  /** 根进程显示名（如 'Codex CLI'）。 */
  rootLabel: string;
  /** 属于此 session 的所有 pid（含根）。 */
  pids: number[];
  /** 根进程创建时间（session 开始近似）。 */
  startedAt: number;
}

export interface BuildSessionsOptions {
  /** 种子判定函数，默认用 labelForProcess 判 ai/ai-ide。可注入便于测试。 */
  isSeed?: (p: ProcessInfo) => { kind: string; label: string } | null;
}

/**
 * 从瞬时进程快照识别 AI 会话（E1，单快照 MVP）。
 *
 * 算法：建 ppid 反向邻接 → 识别种子（默认 ai/ai-ide kind）→ 对每个种子
 * DFS 收集后代（visited 防环 + claimed 去重，首种子优先）。
 *
 * 局限（MVP 接受）：根进程退出后，后代因 ppid 断链变"根"，不再属于本 session。
 * 详见 spec §8。
 */
export function buildSessions(processes: ProcessInfo[], options?: BuildSessionsOptions): Session[] {
  const isSeed = options?.isSeed ?? defaultIsSeed;

  // ppid 反向邻接：pid → 其直接子进程
  const childrenOf = new Map<number, ProcessInfo[]>();
  for (const proc of processes) {
    const arr = childrenOf.get(proc.ppid) ?? [];
    arr.push(proc);
    childrenOf.set(proc.ppid, arr);
  }

  // 按原顺序识别种子（保证首种子优先认领）
  const seeds: Array<{ proc: ProcessInfo; kind: string; label: string }> = [];
  for (const proc of processes) {
    const m = isSeed(proc);
    if (m) seeds.push({ proc, kind: m.kind, label: m.label });
  }

  const claimed = new Set<number>();
  const sessions: Session[] = [];

  for (const { proc, kind, label } of seeds) {
    if (claimed.has(proc.pid)) continue; // 已被前一个 session 认领（种子互为后代场景）

    // DFS 收集后代
    const pids: number[] = [];
    const visited = new Set<number>();
    const stack = [proc.pid];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (claimed.has(cur) && cur !== proc.pid) continue; // 已被认领（根自身除外）
      claimed.add(cur);
      pids.push(cur);
      const children = childrenOf.get(cur) ?? [];
      for (const c of children) {
        if (c.pid === cur) continue; // 自引用 guard
        if (!visited.has(c.pid)) stack.push(c.pid);
      }
    }

    sessions.push({
      id: `${proc.pid}:${proc.createTimeMs}`,
      rootPid: proc.pid,
      kind,
      rootLabel: label,
      pids,
      startedAt: proc.createTimeMs,
    });
  }

  return sessions;
}

function defaultIsSeed(p: ProcessInfo): { kind: string; label: string } | null {
  const label = labelForProcess(p.name, p.cmdline);
  if (!label) return null;
  if (label.kind === 'ai' || label.kind === 'ai-ide') return { kind: label.kind, label: label.label };
  return null;
}
