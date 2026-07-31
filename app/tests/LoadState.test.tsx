import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadState } from '../src/components/LoadState';

describe('LoadState', () => {
  it('shows error state with message', () => {
    render(<LoadState loading={false} error="boom" empty={false} isFirstLoad={false} />);
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows spinner on first load + loading', () => {
    render(<LoadState loading={true} error={null} empty={false} isFirstLoad={true} />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('shows empty state text', () => {
    render(
      <LoadState
        loading={false}
        error={null}
        empty={true}
        emptyText="无数据"
        isFirstLoad={false}
      />
    );
    expect(screen.getByText('无数据')).toBeInTheDocument();
  });

  it('renders null when data present', () => {
    const { container } = render(
      <LoadState loading={false} error={null} empty={false} isFirstLoad={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('paused 时错误态文案改为「恢复后自动重试」（UX-31）', () => {
    render(
      <LoadState loading={false} error="boom" empty={false} isFirstLoad={false} paused />
    );
    expect(screen.getByText(/恢复后自动重试/)).toBeInTheDocument();
    expect(screen.queryByText(/将在下次轮询时自动重试/)).not.toBeInTheDocument();
  });
});
