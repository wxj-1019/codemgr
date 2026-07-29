import { describe, it, expect, beforeEach } from 'vitest';
import { useFocusStore } from '../src/store/focusStore';

describe('focusStore', () => {
  beforeEach(() => {
    useFocusStore.getState().focus(null);
    useFocusStore.getState().focusSession(null);
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

  it('focusSession sets focusedSessionId independently of focusedPid', () => {
    useFocusStore.getState().focus(1234, 'port');
    useFocusStore.getState().focusSession('10:1000');
    expect(useFocusStore.getState().focusedPid).toBe(1234);
    expect(useFocusStore.getState().focusedSessionId).toBe('10:1000');
    useFocusStore.getState().focusSession(null);
    expect(useFocusStore.getState().focusedSessionId).toBeNull();
    expect(useFocusStore.getState().focusedPid).toBe(1234); // 不受影响
  });
});
