import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// 一个故意抛错的子组件，用于触发错误边界
function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom-error');
  return <div>正常内容</div>;
}

describe('ErrorBoundary', () => {
  // 抑制 React 故意抛错时的 console.error 噪音
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('正常子树照常渲染', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('子树抛错时显示默认降级 UI（含错误信息）', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('界面渲染出错')).toBeInTheDocument();
    expect(screen.getByText('boom-error')).toBeInTheDocument();
  });

  it('点击「重试」重新挂载子树', () => {
    // 用可控的 props：先抛错，重试后恢复
    let throwIt = true;
    function Toggle() {
      if (throwIt) throw new Error('toggle-boom');
      return <div>已恢复</div>;
    }
    const { rerender } = render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByText('界面渲染出错')).toBeInTheDocument();

    // 重试前先把 throw 关掉，让重试挂载成功
    throwIt = false;
    fireEvent.click(screen.getByText('重试'));
    // rerender 保持同一 ErrorBoundary 实例（重试已清 error 态）
    rerender(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByText('已恢复')).toBeInTheDocument();
  });

  it('点击「刷新页面」调用 window.location.reload', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    });
    render(
      <ErrorBoundary>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('刷新页面'));
    expect(reloadSpy).toHaveBeenCalledOnce();
  });

  it('提供自定义 fallback 时使用它', () => {
    const fallback = vi.fn((err, reset) => (
      <button onClick={reset}>自定义恢复-{err.message}</button>
    ));
    render(
      <ErrorBoundary fallback={fallback}>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    // StrictMode 下 fallback 可能被调用多次，断言"至少一次"更稳妥
    expect(fallback).toHaveBeenCalled();
    expect(screen.getByText('自定义恢复-boom-error')).toBeInTheDocument();
  });

  it('错误上报到 console.error', () => {
    const spy = vi.spyOn(console, 'error');
    render(
      <ErrorBoundary>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    // componentDidCatch 会调用 console.error（包含 'ErrorBoundary caught:'）
    expect(spy.mock.calls.some((c) => String(c[0]).includes('ErrorBoundary caught'))).toBe(true);
  });
});

describe('ErrorBoundary 面板级隔离（UX-15）', () => {
  it('崩溃的面板子树外内容不受影响', () => {
    const Boom = () => { throw new Error('panel boom'); };
    render(
      <div>
        <ErrorBoundary><Boom /></ErrorBoundary>
        <p>其他面板正常</p>
      </div>
    );
    expect(screen.getByText(/渲染出错/)).toBeInTheDocument();
    expect(screen.getByText('其他面板正常')).toBeInTheDocument();
  });

  it('重试按钮 reset 后可恢复', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('flaky');
      return <p>已恢复</p>;
    };
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    expect(screen.getByText(/渲染出错/)).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByText('重试'));
    expect(screen.getByText('已恢复')).toBeInTheDocument();
  });
});
