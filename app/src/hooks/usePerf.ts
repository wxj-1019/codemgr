import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { usePerfStore } from '../store/perfStore';

const POLL_MS = 1000; // performance panel refresh interval (1s)

export function usePerf() {
  const setPerf = usePerfStore((s) => s.setPerf);
  const setLoading = usePerfStore((s) => s.setLoading);
  const setError = usePerfStore((s) => s.setError);
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
      const isFirst = firstRef.current;
      if (isFirst) setLoading(true);  // only first load shows loading
      try {
        const p = await ipc.fetchPerf();
        if (stoppedRef.current) return;
        if (p) {
          setPerf(p);
          firstRef.current = false;
        } else {
          setError('perfCounters 返回空');
        }
      } catch (e) {
        if (!stoppedRef.current) setError(String(e));
      } finally {
        busyRef.current = false;
        // 成功路径也会把 firstRef 置 false；用 isFirst 快照保证 loading 一定复位
        if (isFirst && !stoppedRef.current) setLoading(false);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
    };
  }, [setPerf, setLoading, setError]);
}
