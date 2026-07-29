import { describe, it, expect, beforeEach } from 'vitest';
import { useFocusStore } from '../src/store/focusStore';

describe('focusStore', () => {
  beforeEach(() => {
    useFocusStore.getState().focus(null);
  });

  it('initial state is null', () => {
    expect(useFocusStore.getState().focusedPid).toBeNull();
    expect(useFocusStore.getState().sourcePanel).toBeNull();
  });

  it('focus(pid, source) sets both', () => {
    useFocusStore.getState().focus(1234, 'port');
    expect(useFocusStore.getState().focusedPid).toBe(1234);
    expect(useFocusStore.getState().sourcePanel).toBe('port');
  });

  it('focus(null) clears both', () => {
    useFocusStore.getState().focus(1234, 'perf');
    useFocusStore.getState().focus(null);
    expect(useFocusStore.getState().focusedPid).toBeNull();
    expect(useFocusStore.getState().sourcePanel).toBeNull();
  });

  it('focus(pid) without source defaults sourcePanel to null', () => {
    useFocusStore.getState().focus(5678);
    expect(useFocusStore.getState().focusedPid).toBe(5678);
    expect(useFocusStore.getState().sourcePanel).toBeNull();
  });
});
