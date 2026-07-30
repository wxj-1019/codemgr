// 端口行动作纯逻辑：浏览器 URL 构造 + 右键菜单构建（PortTable 用）。
import type { NetConnection } from '../../electron/ipc-types';
import type { ContextMenuItem } from '../components/ContextMenu';

/** TCP 监听行 → 回环 http URL。不嗅探 https；绑定 ::/0.0.0.0 统一回 127.0.0.1。 */
export function browseUrlFor(
  conn: Pick<NetConnection, 'protocol' | 'state' | 'localPort'>,
): string | null {
  if (conn.protocol !== 'tcp' || conn.state !== 'LISTENING') return null;
  return `http://127.0.0.1:${conn.localPort}`;
}

export interface PortMenuHandlers {
  onBrowse: (url: string) => void;
  onCopy: (text: string) => void;
  onLocate: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
}

/** 端口表右键菜单：导航动作在上，danger 沉底（与进程菜单同约定）。 */
export function buildPortMenuItems(conn: NetConnection, handlers: PortMenuHandlers): ContextMenuItem[] {
  const url = browseUrlFor(conn);
  const name = conn.processName || `PID ${conn.pid}`;
  return [
    { label: '在浏览器打开', disabled: url === null, onSelect: () => { if (url) handlers.onBrowse(url); } },
    { label: '定位到进程', onSelect: () => handlers.onLocate(conn.pid) },
    { label: '复制端口', dividerBefore: true, onSelect: () => handlers.onCopy(String(conn.localPort)) },
    { label: '复制 PID', onSelect: () => handlers.onCopy(String(conn.pid)) },
    { label: '结束进程', dividerBefore: true, danger: true, onSelect: () => handlers.onKill(conn.pid, name) },
  ];
}
