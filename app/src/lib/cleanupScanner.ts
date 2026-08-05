import type { ProcessInfo } from '../../electron/ipc-types';
import type { Issue } from './issueDetector';

export type CleanupReason = 'issue-target' | 'large-memory';

export interface CleanupCandidate {
  pid: number;
  name: string;
  reason: CleanupReason;
  cpuPercent: number;   // 0-100 相对单核（cpuMap 取值，缺省 0）
  memoryBytes: number;
}

export const CLEANUP_LIST_CAP = 15;
export const DEFAULT_LARGE_MEMORY_BYTES = 1.5 * 1024 * 1024 * 1024;
/** Idle/System/Registry 等内核保留 pid，永不列入清理候选（其余保护由 native IsProtected 兜底） */
const RESERVED_PIDS = new Set([0, 4, 8]);
const ISSUE_RULES: ReadonlySet<Issue['rule']> = new Set(['process-cpu', 'memory-growth']);

export interface CleanupScanInput {
  processes: ProcessInfo[];
  cpuMap: Record<number, number>;
  issues: Issue[];
  largeMemoryBytes?: number;
}

export function scanCleanupCandidates(input: CleanupScanInput): CleanupCandidate[] {
  const { processes, cpuMap, issues, largeMemoryBytes = DEFAULT_LARGE_MEMORY_BYTES } = input;
  const byPid = new Map(processes.filter((p) => !RESERVED_PIDS.has(p.pid)).map((p) => [p.pid, p]));
  const issuePids = new Set(
    issues.filter((i) => ISSUE_RULES.has(i.rule) && i.processId !== undefined && byPid.has(i.processId!))
      .map((i) => i.processId!),
  );
  const candidates: CleanupCandidate[] = [];
  for (const pid of issuePids) {
    const p = byPid.get(pid)!;
    candidates.push({ pid, name: p.name, reason: 'issue-target', cpuPercent: cpuMap[pid] ?? 0, memoryBytes: p.workingSetBytes });
  }
  for (const [pid, p] of byPid) {
    if (issuePids.has(pid)) continue;
    if (p.workingSetBytes > largeMemoryBytes) {
      candidates.push({ pid, name: p.name, reason: 'large-memory', cpuPercent: cpuMap[pid] ?? 0, memoryBytes: p.workingSetBytes });
    }
  }
  // issue-target 优先，其余按内存降序
  return candidates
    .sort((a, b) => (a.reason === b.reason ? b.memoryBytes - a.memoryBytes : a.reason === 'issue-target' ? -1 : 1))
    .slice(0, CLEANUP_LIST_CAP);
}
