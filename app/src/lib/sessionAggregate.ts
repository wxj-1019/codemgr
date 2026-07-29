import type { ProcessInfo, NetConnection } from '../../electron/ipc-types';
import { isListenLike } from './portFilter';

export interface SessionAggregate {
  processCount: number;
  totalCpu: number;
  totalMemory: number;
  listenPortCount: number;
}

/**
 * 聚合一个 session 的资源（E2）。纯函数，O(session pids + connections)。
 */
export function aggregateSession(
  pids: number[],
  processes: ProcessInfo[],
  cpuMap: Record<number, number>,
  connections: NetConnection[],
): SessionAggregate {
  const pidSet = new Set(pids);
  let totalMemory = 0;
  for (const p of processes) {
    if (pidSet.has(p.pid)) totalMemory += p.workingSetBytes;
  }
  let totalCpu = 0;
  for (const pid of pids) totalCpu += cpuMap[pid] || 0;
  let listenPortCount = 0;
  for (const c of connections) {
    if (pidSet.has(c.pid) && isListenLike(c)) listenPortCount++;
  }
  return { processCount: pids.length, totalCpu, totalMemory, listenPortCount };
}
