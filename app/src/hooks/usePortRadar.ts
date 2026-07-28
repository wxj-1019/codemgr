import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { usePortRadarStore } from '../store/portRadarStore';

const POLL_MS = 3000;  // 端口雷达刷新间隔（spec §5.1）

// 挂载后每 3s 拉一次连接列表写入 store。组件卸载时清定时器。
//
// 防重叠：busyRef 守卫确保上一次轮询未完成时不会发起新请求。
// 防闪烁：loading 仅在首次加载（firstRef）时置 true，后续轮询静默刷新，
//        避免头部 "刷新中…" 每个周期都闪一下。
export function usePortRadar() {
  const setConnections = usePortRadarStore((s) => s.setConnections);
  const setLoading = usePortRadarStore((s) => s.setLoading);
  const setError = usePortRadarStore((s) => s.setError);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const firstRef = useRef(true);

  useEffect(() => {
    stoppedRef.current = false;
    busyRef.current = false;
    firstRef.current = true;

    async function poll() {
      if (busyRef.current) return;          // in-flight guard
      busyRef.current = true;
      if (firstRef.current) setLoading(true);  // only first load shows loading
      try {
        const conns = await ipc.fetchConnections();
        if (!stoppedRef.current) {
          setConnections(conns);
          firstRef.current = false;
        }
      } catch (e) {
        if (!stoppedRef.current) setError(String(e));
      } finally {
        busyRef.current = false;
        if (firstRef.current && !stoppedRef.current) setLoading(false);
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
