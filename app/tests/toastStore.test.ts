import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useToastStore } from '../src/store/toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  it('adds a toast with auto-generated id', () => {
    useToastStore.getState().addToast({ type: 'success', message: 'done' });
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('done');
    expect(toasts[0].id).toMatch(/^toast-/);
  });

  it('removes a toast by id', () => {
    useToastStore.getState().addToast({ type: 'info', message: 'hi' });
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-removes after 4 seconds', () => {
    useToastStore.getState().addToast({ type: 'success', message: 'gone soon' });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps max 3 toasts', () => {
    for (let i = 0; i < 5; i++) {
      useToastStore.getState().addToast({ type: 'info', message: `msg ${i}` });
    }
    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useToastStore.getState().toasts[0].message).toBe('msg 4');
  });
});
