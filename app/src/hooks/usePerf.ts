import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { usePerfStore } from '../store/perfStore';

const POLL_MS = 1000; // performance panel refresh interval (1s)

export function usePerf() {
  const setPerf = usePerfStore((s) => s.setPerf);
  const setError = usePerfStore((s) => s.setError);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      try {
        const p = await ipc.fetchPerf();
        if (!stoppedRef.current) {
          if (p) setPerf(p);
          else setError('perfCounters 返回空');
        }
      } catch (e) {
        if (!stoppedRef.current) setError(String(e));
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
    };
  }, [setPerf, setError]);
}
