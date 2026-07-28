import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { useProcessPanelStore } from '../store/processPanelStore';

const POLL_MS = 2000;  // process panel refresh interval (spec 5.1)

export function useProcessPanel() {
  const setProcesses = useProcessPanelStore((s) => s.setProcesses);
  const setCpuMap = useProcessPanelStore((s) => s.setCpuMap);
  const setLoading = useProcessPanelStore((s) => s.setLoading);
  const setError = useProcessPanelStore((s) => s.setError);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      setLoading(true);
      try {
        const procs = await ipc.fetchProcesses();
        if (!stoppedRef.current) setProcesses(procs);
        const cpus = await ipc.fetchCpu();
        if (!stoppedRef.current) setCpuMap(cpus);
      } catch (e) {
        if (!stoppedRef.current) setError(String(e));
      } finally {
        if (!stoppedRef.current) setLoading(false);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { stoppedRef.current = true; clearInterval(timer); };
  }, [setProcesses, setCpuMap, setLoading, setError]);
}
