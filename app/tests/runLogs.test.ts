import { describe, it, expect } from 'vitest';
import { createRunLogViewState, mergeLogChunk, MAX_RENDER_LOG_LINES } from '../src/lib/runLogs';

describe('mergeLogChunk', () => {
  it('追加新行并更新 nextSeq/droppedBefore', () => {
    const s0 = createRunLogViewState();
    const s1 = mergeLogChunk(s0, { lines: [{ seq: 1, text: 'a' }, { seq: 2, text: 'b' }], droppedBefore: 0, nextSeq: 2 });
    expect(s1.lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(s1.nextSeq).toBe(2);
    const s2 = mergeLogChunk(s1, { lines: [{ seq: 3, text: 'c' }], droppedBefore: 4, nextSeq: 3 });
    expect(s2.lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(s2.droppedBefore).toBe(4);
  });

  it('幂等：重复 chunk 不产生重复行', () => {
    const s0 = createRunLogViewState();
    const chunk = { lines: [{ seq: 1, text: 'a' }], droppedBefore: 0, nextSeq: 1 };
    const s1 = mergeLogChunk(s0, chunk);
    const s2 = mergeLogChunk(s1, chunk);
    expect(s2.lines).toHaveLength(1);
  });

  it('渲染层也封顶（防长驻面板内存膨胀）', () => {
    const s0 = createRunLogViewState();
    const lines = Array.from({ length: MAX_RENDER_LOG_LINES + 50 }, (_, i) => ({ seq: i + 1, text: `l${i + 1}` }));
    const s1 = mergeLogChunk(s0, { lines, droppedBefore: 0, nextSeq: lines.length });
    expect(s1.lines).toHaveLength(MAX_RENDER_LOG_LINES);
    expect(s1.lines[0]!.text).toBe('l51');
  });
});
