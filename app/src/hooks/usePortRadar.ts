import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { usePortRadarStore } from '../store/portRadarStore';

const POLL_MS = 3000;  // 端口雷达刷新间隔（spec §5.1）

// 挂载后每 3s 拉一次连接列表写入 store。组件卸载时清定时器。
export function usePortRadar() {
  const setConnections = usePortRadarStore((s) => s.setConnections);
  const setLoading = usePortRadarStore((s) => s.setLoading);
  const setError = usePortRadarStore((s) => s.setError);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      setLoading(true);
      try {
        const conns = await ipc.fetchConnections();
        if (!stoppedRef.current) setConnections(conns);
      } catch (e) {
        if (!stoppedRef.current) setError(String(e));
      } finally {
        if (!stoppedRef.current) setLoading(false);
      }
    }

    poll();  // 立即跑一次
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
    };
  }, [setConnections, setLoading, setError]);
}
