import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToastStore, __resetToastStoreForTests } from '../src/store/toastStore';
import { notify } from '../src/lib/notify';

beforeEach(() => { vi.useFakeTimers(); __resetToastStoreForTests(); });
afterEach(() => { vi.useRealTimers(); });

describe('toastStore.push', () => {
  it('自增 id 入栈，kind 映射时长', () => {
    const s = useToastStore.getState();
    const id1 = s.push('success', 'a');
    const id2 = s.push('error', 'b');
    expect(id2).toBeGreaterThan(id1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toMatchObject({ kind: 'success', message: 'a', durationMs: 4000 });
    expect(toasts[1]).toMatchObject({ kind: 'error', message: 'b', durationMs: 8000 });
  });

  it('栈上限 5：第 6 条丢弃最旧且其定时器被清理', () => {
    const s = useToastStore.getState();
    for (let i = 1; i <= 5; i++) s.push('info', `m${i}`);
    s.push('info', 'm6');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(5);
    expect(toasts.map((t) => t.message)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
  });

  it('success 4000ms 自动消失，error 8000ms 前不消失', () => {
    const s = useToastStore.getState();
    s.push('success', 's');
    s.push('error', 'e');
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts.map((t) => t.kind)).toEqual(['error']);
    vi.advanceTimersByTime(3999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('warning kind：时长 4000ms，notify.warning 可达', () => {
    const s = useToastStore.getState();
    const id = s.push('warning', '部分成功');
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: 'warning', message: '部分成功', durationMs: 4000 });
    s.dismiss(id);
    notify.warning('警告');
    expect(useToastStore.getState().toasts[0].kind).toBe('warning');
  });

  it('dismiss 手动移除且幂等', () => {
    const s = useToastStore.getState();
    const id = s.push('info', 'x');
    s.dismiss(id);
    s.dismiss(id); // 幂等不抛错
    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.advanceTimersByTime(10000); // 定时器已清，无残留副作用
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('notify', () => {
  it('success/error/info 三出口写入 store', () => {
    notify.success('ok');
    notify.error('bad');
    notify.info('fyi');
    expect(useToastStore.getState().toasts.map((t) => [t.kind, t.message])).toEqual([
      ['success', 'ok'], ['error', 'bad'], ['info', 'fyi'],
    ]);
  });
});
