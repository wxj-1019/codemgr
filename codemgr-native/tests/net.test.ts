import { describe, it, expect } from 'vitest';
import native from '../index';

describe('netScan', () => {
  it('returns an array', () => {
    const conns = native.netScan();
    expect(Array.isArray(conns)).toBe(true);
  });

  it('includes at least one listening port', () => {
    const conns = native.netScan();
    const listening = conns.filter(c => c.state === 'LISTENING');
    // Windows 总有服务在监听（如 RPC、SVCHOST）
    expect(listening.length).toBeGreaterThan(0);
  });

  it('fills processName for connections with a valid pid', () => {
    const conns = native.netScan();
    const withPid = conns.filter((c) => c.pid > 0);
    expect(withPid.length).toBeGreaterThan(0);
    // 至少 90% 的连接能解析出进程名（少数系统连接可能失败）
    const named = withPid.filter((c) => c.processName.length > 0);
    expect(named.length / withPid.length).toBeGreaterThan(0.9);
  });

  it('all TCP entries have valid fields', () => {
    const conns = native.netScan().filter(c => c.protocol === 'tcp');
    for (const c of conns) {
      expect(typeof c.localAddr).toBe('string');
      expect(c.localAddr.length).toBeGreaterThan(0);
      expect(c.localPort).toBeGreaterThanOrEqual(0);
      expect(c.localPort).toBeLessThanOrEqual(65535);
      expect(typeof c.state).toBe('string');
      expect(c.state.length).toBeGreaterThan(0);
      expect(typeof c.pid).toBe('number');
    }
  });
});
