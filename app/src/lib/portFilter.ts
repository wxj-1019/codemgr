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
