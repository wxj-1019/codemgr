import { useEffect, useRef } from 'react';
import { ipc } from '../lib/ipc';
import { usePerfStore } from '../store/perfStore';
import { useVisibilityStore, selectPollable } from '../store/visibilityStore';

const PANEL: 'perf' = 'perf';

export function usePerf() {
  const setPerf = usePerfStore((s) => s.setPerf);
  const setLoading = usePerfStore((s) => s.setLoading);
  const setError = usePerfStore((s) => s.setError);
  const setStaleAt = usePerfStore((s) => s.setStaleAt);
  const pollMs = usePerfStore((s) => s.pollMs);
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
        const result = await ipc.fetchPerf();
        if (stoppedRef.current || genRef.current !== gen) return;
        if (result.ok) {
          setPerf(result.data);
          firstRef.current = false;
        } else {
          // 失败：不清空 perf，标陈旧 + 错误（A2）
          setError(result.error.message);
          setStaleAt(result.lastSuccessAt);
          if (isFirst) firstRef.current = false;
        }
      } catch (e) {
        if (!stoppedRef.current && genRef.current === gen) setError(String(e));
      } finally {
        busyRef.current = false;
        // 成功路径也会把 firstRef 置 false；用 isFirst 快照保证 loading 一定复位
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
  }, [setPerf, setLoading, setError, setStaleAt, pollable, pollMs]);
}
