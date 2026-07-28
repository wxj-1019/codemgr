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
      if (firstRef.current) setLoading(true);  // only first load shows loading
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
        if (firstRef.current && !stoppedRef.current) setLoading(false);
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
