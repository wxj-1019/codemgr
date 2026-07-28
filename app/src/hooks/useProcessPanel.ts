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
        const procs = await ipc.fetchProcesses();
        if (stoppedRef.current) return;
        setProcesses(procs);
        firstRef.current = false;
        // CPU is best-effort enrichment: a failure here must NOT tear down the
        // whole panel when we already have the process list. Log and move on.
        try {
          const cpus = await ipc.fetchCpu();
          if (!stoppedRef.current) setCpuMap(cpus);
        } catch (cpuErr) {
          console.error('fetchCpu failed:', cpuErr);
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
    return () => { stoppedRef.current = true; clearInterval(timer); };
  }, [setProcesses, setCpuMap, setLoading, setError]);
}
