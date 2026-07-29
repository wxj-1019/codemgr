import { create } from 'zustand';
import type { Session } from '../lib/sessionAttribution';

interface SessionState {
  sessions: Session[];
  focusedSessionId: string | null;
  setSessions: (s: Session[]) => void;
  setFocusedSession: (id: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  focusedSessionId: null,
  setSessions: (s) => set((prev) => ({
    sessions: s,
    // focusedSessionId 指向的 session 消失 → 清空（防指向幽灵，与 C 的 focusedPid 同模式）
    focusedSessionId:
      prev.focusedSessionId && s.some((x) => x.id === prev.focusedSessionId)
        ? prev.focusedSessionId
        : null,
  })),
  setFocusedSession: (id) => set({ focusedSessionId: id }),
  reset: () => set({ sessions: [], focusedSessionId: null }),
}));
