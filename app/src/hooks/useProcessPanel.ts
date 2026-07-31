import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useVisibilityStore, selectPollable } from '../store/visibilityStore';

const PANEL: 'process' = 'process';

export function useProcessPanel() {
  const setProcesses = useProcessPanelStore((s) => s.setProcesses);
  const setCpuMap = useProcessPanelStore((s) => s.setCpuMap);
  const appendHistory = useProcessPanelStore((s) => s.appendHistory);
  const setLoading = useProcessPanelStore((s) => s.setLoading);
  const setError = useProcessPanelStore((s) => s.setError);
  const setStaleAt = useProcessPanelStore((s) => s.setStaleAt);
  const pollMs = useProcessPanelStore((s) => s.pollMs);
  const pollable = useVisibilityStore(selectPollable(PANEL));
  const stoppedRef = useRef(false);
  // UX-26：effect 重跑世代计数——旧 in-flight 请求完成后校验世代，
  // 杜绝陈旧结果写入新轮询周期（stoppedRef 复位后旧请求会误判存活）。
  const genRef = useRef(0);
  const busyRef = useRef(false);
  const firstRef = useRef(true);

  useEffect(() => {
    const gen = ++genRef.current;
    stoppedRef.current = false;
    busyRef.current = false;

    async function poll() {
      if (busyRef.current) return;          // in-flight guard
      busyRef.current = true;
      const isFirst = firstRef.current;
      if (isFirst) setLoading(true);  // only first load shows loading
      try {
        const result = await ipc.fetchProcesses();
        if (stoppedRef.current || genRef.current !== gen) return;
        if (result.ok) {
          const procs = result.data;
          setProcesses(procs);
          firstRef.current = false;
          // CPU is best-effort enrichment: a failure here must NOT tear down the
          // whole panel when we already have the process list. Log and move on.
          try {
            const cpus = await ipc.fetchCpu();
            if (!stoppedRef.current) {
              setCpuMap(cpus);
              // 同一 tick 同时有 procs（含 mem）与 cpus（含 cpu），采一条历史点
              appendHistory(procs, cpus, Date.now());
            }
          } catch (cpuErr) {
            console.error('fetchCpu failed:', cpuErr);
          }
        } else {
          // 失败：不清空 processes，标陈旧 + 错误（A2）
          setError(result.error.message);
          setStaleAt(result.lastSuccessAt);
          if (isFirst) firstRef.current = false;
        }
      } catch (e) {
        if (!stoppedRef.current && genRef.current === gen) setError(String(e));
      } finally {
        busyRef.current = false;
        // 成功或失败都必须清掉首载 loading；原先在成功路径里先把 firstRef
        // 置 false，导致 finally 里 setLoading(false) 永远不跑，头部常驻「刷新中…」。
        if (isFirst && !stoppedRef.current) setLoading(false);
      }
    }

    if (!pollable) return;  // 不可见：不启动轮询
    poll();
    if (pollMs <= 0) return;  // 暂停：不建 interval（effect 重跑时仍会补一次刷新）
    const timer = setInterval(poll, pollMs);
    return () => {
      stoppedRef.current = true;
      genRef.current++;
      clearInterval(timer);
    };
  }, [setProcesses, setCpuMap, appendHistory, setLoading, setError, setStaleAt, pollable, pollMs]);
}
