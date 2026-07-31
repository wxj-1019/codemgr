import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunLogView } from '../src/components/RunLogView';

function mockGetRunLogs(impl: (runId: string, sinceSeq: number) => Promise<unknown>) {
  Object.defineProperty(window, 'codemgr', {
    value: { getRunLogs: vi.fn(impl) },
    writable: true, configurable: true,
  });
  return (window as unknown as { codemgr: { getRunLogs: ReturnType<typeof vi.fn> } }).codemgr.getRunLogs;
}

describe('RunLogView', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('挂载全量拉取（sinceSeq=0）并渲染行与丢弃提示', async () => {
    mockGetRunLogs(async () => ({
      lines: [{ seq: 1, text: 'ready in 300ms' }, { seq: 2, text: 'listening :3000' }],
      droppedBefore: 12, nextSeq: 2,
    }));
    render(<RunLogView runId="r1" />);
    await waitFor(() => expect(screen.getByText('ready in 300ms')).toBeInTheDocument());
    expect(screen.getByText('listening :3000')).toBeInTheDocument();
    expect(screen.getByText(/已丢弃早期 12 行/)).toBeInTheDocument();
  });

  it('增量拉取传上次 nextSeq；清空仅清本地视图', async () => {
    const fn = mockGetRunLogs(async (_r: string, since: number) => since === 0
      ? { lines: [{ seq: 1, text: 'first' }], droppedBefore: 0, nextSeq: 1 }
      : { lines: [], droppedBefore: 0, nextSeq: 1 });
    render(<RunLogView runId="r1" />);
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
    expect(fn).toHaveBeenCalledWith('r1', 0);
    fireEvent.click(screen.getByRole('button', { name: '清空本地日志视图' }));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('暂无输出')).toBeInTheDocument();
  });
});
