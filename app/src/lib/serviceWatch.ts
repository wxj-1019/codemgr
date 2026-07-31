// 服务守望纯逻辑（子项目 D）：状态跃迁事件 diff + 就绪浏览 URL。
import type { ServiceStatus, ServiceStatusKind } from './devService';

export interface ServiceWatchEvent {
  type: 'listening' | 'conflict';
  profileId: string;
  profileName: string;
  ports: number[];
  heldBy: number[];
}

/** prev/next 按 profileId 比对 kind，仅跃迁产出事件（listening/conflict），其余 kind 静默。 */
export function diffServiceEvents(
  prev: ReadonlyMap<string, ServiceStatusKind>,
  next: ReadonlyMap<string, { name: string; status: ServiceStatus }>,
): ServiceWatchEvent[] {
  const events: ServiceWatchEvent[] = [];
  for (const [profileId, { name, status }] of next) {
    if (prev.get(profileId) === status.kind) continue;
    if (status.kind === 'listening' && status.ports) {
      events.push({ type: 'listening', profileId, profileName: name, ports: status.ports.map((p) => p.port), heldBy: [] });
    } else if (status.kind === 'conflict' && status.ports) {
      const bad = status.ports.filter((p) => p.conflict);
      events.push({
        type: 'conflict', profileId, profileName: name,
        ports: bad.map((p) => p.port),
        heldBy: bad.map((p) => p.heldBy ?? 0).filter((pid) => pid > 0),
      });
    }
  }
  return events;
}

/** 就绪服务的浏览 URL：首个非冲突已监听端口；非 listening → null。 */
export function browseUrlForService(status: ServiceStatus): string | null {
  if (status.kind !== 'listening' || !status.ports) return null;
  const p = status.ports.find((x) => !x.conflict && x.heldBy !== null);
  return p ? `http://127.0.0.1:${p.port}` : null;
}
