import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { usePortRadarStore } from '../store/portRadarStore';
import { useVisibilityStore, selectPollable } from '../store/visibilityStore';

const POLL_MS = 3000;  // 端口雷达刷新间隔（spec §5.1）
const PANEL: 'port' = 'port';

// 挂载后每 3s 拉一次连接列表写入 store。
//
// 可见性节流：面板不可见（被遮挡/折叠/整窗最小化）时停掉轮询，避免与
// native 采集竞争（roadmap R2）。可见时恢复，并立即补一次刷新。
//
// 防重叠：busyRef 守卫确保上一次轮询未完成时不会发起新请求。
// 防闪烁：loading 仅在首次加载（firstRef）时置 true，后续轮询静默刷新，
//        避免头部 "刷新中…" 每个周期都闪一下。
export function usePortRadar() {
  const setConnections = usePortRadarStore((s) => s.setConnections);
  const setLoading = usePortRadarStore((s) => s.setLoading);
  const setError = usePortRadarStore((s) => s.setError);
  const pollable = useVisibilityStore(selectPollable(PANEL));
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const firstRef = useRef(true);

  useEffect(() => {
    stoppedRef.current = false;
    busyRef.current = false;

    async function poll() {
      if (busyRef.current) return;          // in-flight guard
      busyRef.current = true;
      const isFirst = firstRef.current;
      if (isFirst) setLoading(true);  // only first load shows loading
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
        // 成功路径也会把 firstRef 置 false；用 isFirst 快照保证 loading 一定复位
        if (isFirst && !stoppedRef.current) setLoading(false);
      }
    }

    if (!pollable) return;  // 不可见：不启动轮询（effect 在可见时重跑）
    poll();  // 立即跑一次
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
    };
  }, [setConnections, setLoading, setError, pollable]);
}
