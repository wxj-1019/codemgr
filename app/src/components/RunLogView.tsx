import { useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import { createRunLogViewState, mergeLogChunk, type RunLogViewState } from '../lib/runLogs';

const POLL_MS = 2000;

/**
 * Run 日志视图（子项目 C）：挂载全量拉，之后 2s 增量（busyRef 防重入 + 卸载清理）。
 * 跟随滚动：用户停在上翻位置时不拽回；回到底部附近后新行继续自动跟随。
 * 「清空」只清本地视图（main cursor 不动），不会触发全量重拉。
 */
export function RunLogView({ runId }: { runId: string }) {
  const [state, setState] = useState<RunLogViewState>(createRunLogViewState);
  const [fetchError, setFetchError] = useState(false);
  const boxRef = useRef<HTMLPreElement>(null);
  const atBottomRef = useRef(true);
  const busyRef = useRef(false);
  const nextSeqRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    setState(createRunLogViewState());
    setFetchError(false);
    nextSeqRef.current = 0;
    atBottomRef.current = true;

    async function tick() {
      if (busyRef.current || stopped) return;
      busyRef.current = true;
      try {
        const chunk = await ipc.getRunLogs(runId, nextSeqRef.current);
        if (stopped || chunk === null) return;
        setState((prev) => {
          const next = mergeLogChunk(prev, chunk);
          nextSeqRef.current = next.nextSeq;
          return next;
        });
        setFetchError(false);
      } catch {
        if (!stopped) setFetchError(true);
      } finally {
        busyRef.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [runId]);

  // 跟随滚动：仅当视口在底部附近时，新行到达自动滚到底
  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [state.lines]);

  function onScroll() {
    const el = boxRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  return (
    <div className="mt-2 rounded border border-base-700 bg-base-900">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-fg-muted">
        <span>
          {state.lines.length} 行
          {state.droppedBefore > 0 ? ` · 已丢弃早期 ${state.droppedBefore} 行` : ''}
          {fetchError ? ' · 日志拉取出错' : ''}
        </span>
        <button
          aria-label="清空本地日志视图"
          onClick={() => setState(createRunLogViewState())}
          className="rounded px-1 hover:bg-base-700 hover:text-fg-primary"
        >
          清空
        </button>
      </div>
      <pre
        ref={boxRef}
        onScroll={onScroll}
        className="max-h-64 overflow-auto px-2 py-1 font-mono text-[11px] leading-4 text-fg-secondary"
      >
        {state.lines.length === 0
          ? '暂无输出'
          : state.lines.map((l) => <div key={l.seq}>{l.text === '' ? ' ' : l.text}</div>)}
      </pre>
    </div>
  );
}