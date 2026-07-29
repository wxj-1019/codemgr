import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../src/store/sessionStore';
import type { Session } from '../src/lib/sessionAttribution';

const session = (over: Partial<Session> = {}): Session => ({
  id: '10:1000', rootPid: 10, kind: 'ai', rootLabel: 'Codex CLI',
  pids: [10, 11], startedAt: 1000, ...over,
});

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it('initial state empty', () => {
    expect(useSessionStore.getState().sessions).toEqual([]);
    expect(useSessionStore.getState().focusedSessionId).toBeNull();
  });

  it('setSessions stores sessions', () => {
    useSessionStore.getState().setSessions([session()]);
    expect(useSessionStore.getState().sessions).toHaveLength(1);
  });

  it('setSessions clears focusedSessionId when its session disappears', () => {
    useSessionStore.getState().setSessions([session({ id: '10:1000' })]);
    useSessionStore.getState().setFocusedSession('10:1000');
    expect(useSessionStore.getState().focusedSessionId).toBe('10:1000');
    useSessionStore.getState().setSessions([session({ id: '20:2000' })]);
    expect(useSessionStore.getState().focusedSessionId).toBeNull();
  });

  it('setSessions keeps focusedSessionId when its session persists', () => {
    useSessionStore.getState().setSessions([session({ id: '10:1000' })]);
    useSessionStore.getState().setFocusedSession('10:1000');
    useSessionStore.getState().setSessions([session({ id: '10:1000' }), session({ id: '20:2000' })]);
    expect(useSessionStore.getState().focusedSessionId).toBe('10:1000');
  });

  it('reset clears everything', () => {
    useSessionStore.getState().setSessions([session()]);
    useSessionStore.getState().setFocusedSession('10:1000');
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().sessions).toEqual([]);
    expect(useSessionStore.getState().focusedSessionId).toBeNull();
  });
});
