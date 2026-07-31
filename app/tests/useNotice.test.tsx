import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotice } from '../src/hooks/useNotice';

describe('useNotice', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('show 设置 notice（tone + text）', () => {
    const { result } = renderHook(() => useNotice());
    act(() => result.current.show('success', '已结束 1 个进程'));
    expect(result.current.notice).toEqual({ tone: 'success', text: '已结束 1 个进程' });
  });

  it('duration 后自动清除', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotice(3000));
    act(() => result.current.show('danger', '结束失败'));
    expect(result.current.notice).not.toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.notice).toBeNull();
  });

  it('再次 show 重置计时器（旧 timer 不会提前清掉新 notice）', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotice(3000));
    act(() => result.current.show('success', 'A'));
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => result.current.show('success', 'B'));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.notice).toEqual({ tone: 'success', text: 'B' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.notice).toBeNull();
  });
});
