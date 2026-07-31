import { describe, it, expect } from 'vitest';
import { browseUrlFor, buildPortMenuItems, type PortMenuHandlers } from '../src/lib/portActions';
import type { NetConnection } from '../electron/ipc-types';

const tcpListen: NetConnection = {
  protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000,
  remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 1234, processName: 'node.exe',
};

function makeHandlers(): PortMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onBrowse: (url) => calls.push(`browse:${url}`),
    onCopy: (t) => calls.push(`copy:${t}`),
    onLocate: (pid) => calls.push(`locate:${pid}`),
    onKill: (pid, name) => calls.push(`kill:${pid}:${name}`),
  };
}

describe('browseUrlFor', () => {
  it('TCP 监听 → 回环 http URL（不区分绑定地址）', () => {
    expect(browseUrlFor(tcpListen)).toBe('http://127.0.0.1:3000');
    expect(browseUrlFor({ ...tcpListen, localAddr: '::' })).toBe('http://127.0.0.1:3000');
  });
  it('UDP / 非监听 → null', () => {
    expect(browseUrlFor({ ...tcpListen, protocol: 'udp', state: '' })).toBeNull();
    expect(browseUrlFor({ ...tcpListen, state: 'ESTABLISHED' })).toBeNull();
  });
});

describe('buildPortMenuItems', () => {
  it('TCP 监听行：菜单五项，浏览器打开可用并回调 URL', () => {
    const h = makeHandlers();
    const items = buildPortMenuItems(tcpListen, h);
    expect(items.map((i) => i.label)).toEqual([
      '在浏览器打开', '定位到进程', '复制端口', '复制 PID', '结束进程',
    ]);
    expect(items[0]!.disabled).toBeFalsy();
    items[0]!.onSelect();
    expect(h.calls).toContain('browse:http://127.0.0.1:3000');
  });
  it('UDP 行：浏览器打开禁用，其余可用；进程名为空时 kill 用 PID 兜底', () => {
    const h = makeHandlers();
    const udp: NetConnection = { ...tcpListen, protocol: 'udp', state: '', processName: '' };
    const items = buildPortMenuItems(udp, h);
    expect(items[0]!.disabled).toBe(true);
    items[4]!.onSelect();
    expect(h.calls).toContain('kill:1234:PID 1234');
  });
  it('复制与定位回调参数正确', () => {
    const h = makeHandlers();
    const items = buildPortMenuItems(tcpListen, h);
    items[2]!.onSelect();
    items[3]!.onSelect();
    items[1]!.onSelect();
    expect(h.calls).toEqual(['copy:3000', 'copy:1234', 'locate:1234']);
  });
});
