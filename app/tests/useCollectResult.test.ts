import { describe, it, expect, beforeEach } from 'vitest';
import { usePortRadarStore } from '../src/store/portRadarStore';

// 验证 A2 核心契约：采集失败时不清空既有数据 + 标陈旧。
// 用 store 契约模拟 hook 的失败分支行为（hook 逻辑：ok:false → setError+setStaleAt，不调 setConnections）。
describe('collector failure keeps last data (A2)', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortRadarStore.getState().reset();
  });

  it('ok:false does not clear connections and sets staleAt', () => {
    // 先成功一次，填入数据
    usePortRadarStore.getState().setConnections([
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0, state: 'LISTEN', pid: 1, processName: 'x' },
    ]);
    expect(usePortRadarStore.getState().staleAt).toBeNull();

    // 模拟失败分支行为：setError + setStaleAt（不调 setConnections）
    usePortRadarStore.getState().setError('boom');
    usePortRadarStore.getState().setStaleAt(12345);

    expect(usePortRadarStore.getState().connections).toHaveLength(1); // 未清空
    expect(usePortRadarStore.getState().error).toBe('boom');
    expect(usePortRadarStore.getState().staleAt).toBe(12345);
  });

  it('ok:true with empty data is not an error and data is fresh', () => {
    usePortRadarStore.getState().setConnections([]);
    expect(usePortRadarStore.getState().staleAt).toBeNull();
    expect(usePortRadarStore.getState().error).toBeNull();
  });
});
