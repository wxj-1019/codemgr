import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastHost } from '../src/components/ToastHost';
import { useToastStore, __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => { vi.useFakeTimers(); __resetToastStoreForTests(); });
afterEach(() => { vi.useRealTimers(); });

describe('ToastHost', () => {
  it('按 store 渲染条目，error 用 role=alert，其余 role=status', () => {
    useToastStore.getState().push('success', '已完成');
    useToastStore.getState().push('error', '失败了');
    render(<ToastHost />);
    expect(screen.getByText('已完成').closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText('失败了').closest('[role="alert"]')).toBeTruthy();
  });

  it('空栈不渲染', () => {
    const { container } = render(<ToastHost />);
    expect(container.firstChild).toBeNull();
  });

  it('点关闭按钮 dismiss 对应条目', () => {
    useToastStore.getState().push('info', '可关闭');
    render(<ToastHost />);
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('warning 用 role=status 渲染', () => {
    useToastStore.getState().push('warning', '部分成功');
    render(<ToastHost />);
    expect(screen.getByText('部分成功').closest('[role="status"]')).toBeTruthy();
  });
});
