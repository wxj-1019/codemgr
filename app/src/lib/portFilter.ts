import type { NetConnection } from '../../electron/ipc-types';

// 只显示监听/占用端口（LISTENING 的 TCP + 全部 UDP），过滤掉大量瞬态连接。
// （自 PortTable.tsx 迁入，供 PortRadar 计数与冲突检测复用。）
export function isListenLike(c: NetConnection): boolean {
  if (c.protocol === 'udp') return true;
  return c.state === 'LISTENING';
}

// 按端口/进程名/PID/本地地址过滤，大小写不敏感；空查询原样返回（保持引用不变，
// 便于 React memo 比较）。
export function filterConnections(conns: NetConnection[], query: string): NetConnection[] {
  const q = query.trim().toLowerCase();
  if (!q) return conns;
  return conns.filter(
    (c) =>
      String(c.localPort).includes(q) ||
      c.processName.toLowerCase().includes(q) ||
      String(c.pid).includes(q) ||
      c.localAddr.toLowerCase().includes(q),
  );
}

// 检测端口冲突：同一端口被两个及以上不同 PID 监听（SO_REUSEADDR 场景）。
// TCP 与 UDP 是独立命名空间，按 `协议:端口` 键聚合判定，避免 DNS/mDNS 等
// 双协议端口误报。返回冲突键集合（如 "tcp:8080"），供表格高亮。
// 只统计监听态连接；同一进程绑定多个地址不算冲突。
export function conflictPorts(conns: NetConnection[]): Set<string> {
  const owners = new Map<string, Set<number>>();
  for (const c of conns) {
    if (!isListenLike(c)) continue;
    const key = `${c.protocol}:${c.localPort}`;
    let pids = owners.get(key);
    if (!pids) {
      pids = new Set<number>();
      owners.set(key, pids);
    }
    pids.add(c.pid);
  }
  const conflicts = new Set<string>();
  for (const [key, pids] of owners) {
    if (pids.size > 1) conflicts.add(key);
  }
  return conflicts;
}

// 冲突端口的持有者 PID 列表（UX-20：tooltip 指明"冲突对方是谁"）。
// 与 conflictPorts 同口径（监听态 + 协议隔离）；返回 `协议:端口` → 监听该端口的
// 全部 PID（含冲突双方，UI 自行排除自身）。
export function conflictHolders(conns: NetConnection[]): Map<string, number[]> {
  const owners = new Map<string, Set<number>>();
  for (const c of conns) {
    if (!isListenLike(c)) continue;
    const key = `${c.protocol}:${c.localPort}`;
    let pids = owners.get(key);
    if (!pids) {
      pids = new Set<number>();
      owners.set(key, pids);
    }
    pids.add(c.pid);
  }
  const holders = new Map<string, number[]>();
  for (const [key, pids] of owners) {
    if (pids.size > 1) holders.set(key, [...pids]);
  }
  return holders;
}
