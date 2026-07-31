import { describe, it, expect } from 'vitest';
import { diffServiceEvents, browseUrlForService } from '../src/lib/serviceWatch';
import type { ServiceStatus, ServiceStatusKind } from '../src/lib/devService';

const listening: ServiceStatus = { kind: 'listening', ports: [{ port: 3000, heldBy: 100, conflict: false }] };
const conflict: ServiceStatus = { kind: 'conflict', ports: [{ port: 3000, heldBy: 200, conflict: true }] };
const starting: ServiceStatus = { kind: 'starting', ports: [{ port: 3000, heldBy: null, conflict: false }] };

function nextOf(entries: [string, string, ServiceStatus][]): ReadonlyMap<string, { name: string; status: ServiceStatus }> {
  return new Map(entries.map(([id, name, status]) => [id, { name, status }]));
}

describe('diffServiceEvents', () => {
  it('kind 不变无事件', () => {
    const prev: ReadonlyMap<string, ServiceStatusKind> = new Map([['p1', 'listening']]);
    expect(diffServiceEvents(prev, nextOf([['p1', '前端', listening]]))).toHaveLength(0);
  });

  it('→listening 发一次，带就绪端口', () => {
    const prev: ReadonlyMap<string, ServiceStatusKind> = new Map([['p1', 'starting']]);
    const ev = diffServiceEvents(prev, nextOf([['p1', '前端', listening]]));
    expect(ev).toEqual([{ type: 'listening', profileId: 'p1', profileName: '前端', ports: [3000], heldBy: [] }]);
  });

  it('→conflict 发一次，带冲突端口与占用者', () => {
    const prev: ReadonlyMap<string, ServiceStatusKind> = new Map([['p1', 'listening']]);
    const ev = diffServiceEvents(prev, nextOf([['p1', '前端', conflict]]));
    expect(ev).toEqual([{ type: 'conflict', profileId: 'p1', profileName: '前端', ports: [3000], heldBy: [200] }]);
  });

  it('starting/exited 不产生事件；新出现 profile 首次就绪也通知', () => {
    expect(diffServiceEvents(new Map(), nextOf([['p1', 'x', starting]]))).toHaveLength(0);
    const prev: ReadonlyMap<string, ServiceStatusKind> = new Map([['p1', 'listening']]);
    expect(diffServiceEvents(prev, nextOf([['p1', 'x', { kind: 'exited' }]]))).toHaveLength(0);
    const ev = diffServiceEvents(new Map(), nextOf([['p1', 'x', listening]]));
    expect(ev).toHaveLength(1); // prev 无记录视为跃迁
  });
});

describe('browseUrlForService', () => {
  it('listening 取首个非冲突端口', () => {
    expect(browseUrlForService(listening)).toBe('http://127.0.0.1:3000');
  });
  it('conflict/starting/exited/no-ports → null', () => {
    expect(browseUrlForService(conflict)).toBeNull();
    expect(browseUrlForService(starting)).toBeNull();
    expect(browseUrlForService({ kind: 'exited' })).toBeNull();
    expect(browseUrlForService({ kind: 'no-ports' })).toBeNull();
  });
});
