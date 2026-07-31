// run 日志视图状态合并（子项目 C）：增量去重 + 渲染层封顶。
import type { RunLogLine, RunLogChunk } from '../../electron/ipc-types';

export const MAX_RENDER_LOG_LINES = 2000;

export interface RunLogViewState {
  lines: RunLogLine[];
  droppedBefore: number;
  nextSeq: number; // 已收到的最大 seq；下次拉取 sinceSeq 传它
}

export function createRunLogViewState(): RunLogViewState {
  return { lines: [], droppedBefore: 0, nextSeq: 0 };
}

/** 合并增量块：只收 seq > prev.nextSeq 的行（幂等），渲染层封顶 2000 行。 */
export function mergeLogChunk(prev: RunLogViewState, chunk: RunLogChunk): RunLogViewState {
  const fresh = chunk.lines.filter((l) => l.seq > prev.nextSeq);
  const lines = fresh.length ? [...prev.lines, ...fresh] : prev.lines;
  return {
    lines: lines.length > MAX_RENDER_LOG_LINES ? lines.slice(-MAX_RENDER_LOG_LINES) : lines,
    droppedBefore: chunk.droppedBefore,
    nextSeq: chunk.nextSeq,
  };
}
