import type { RunState, RunProfile, NetConnection } from '../../electron/ipc-types';
import { isListenLike } from './portFilter';

export type ServiceStatusKind = 'exited' | 'listening' | 'starting' | 'conflict' | 'no-ports';

export interface ServiceStatus {
  kind: ServiceStatusKind;
  /** 每个 expectedPort 的占用情况（kind=listening/starting/conflict 时填）。 */
  ports?: Array<{ port: number; heldBy: number | null; conflict: boolean }>;
}

/**
 * 判定一个 run 的开发服务健康状态（F2）。纯函数。
 * - exited: run 已退出。
 * - no-ports: profile 无 expectedPorts。
 * - listening: 所有 expectedPort 被监听（任意 pid）。
 * - conflict: 某 expectedPort 被非本 run 的 pid 监听。
 * - starting: run running，端口未全部监听，且无冲突。
 */
export function resolveServiceStatus(
  run: RunState,
  profile: RunProfile,
  connections: NetConnection[],
): ServiceStatus {
  if (run.status === 'exited' || run.status === 'failed') return { kind: 'exited' };
  const expected = profile.expectedPorts ?? [];
  if (expected.length === 0) return { kind: 'no-ports' };

  // 监听端口 → 持有 pid 映射
  const listeningByPort = new Map<number, number[]>();
  for (const c of connections) {
    if (isListenLike(c)) {
      const arr = listeningByPort.get(c.localPort) ?? [];
      arr.push(c.pid);
      listeningByPort.set(c.localPort, arr);
    }
  }

  const ports = expected.map((port) => {
    const holders = listeningByPort.get(port) ?? [];
    const heldBy = holders.length > 0 ? holders[0] : null;
    const conflict = holders.length > 0 && !holders.includes(run.pid);
    return { port, heldBy, conflict };
  });

  const hasConflict = ports.some((p) => p.conflict);
  const allListening = ports.every((p) => p.heldBy !== null);

  if (hasConflict) return { kind: 'conflict', ports };
  if (allListening) return { kind: 'listening', ports };
  return { kind: 'starting', ports };
}
