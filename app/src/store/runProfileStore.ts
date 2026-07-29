import { create } from 'zustand';
import type { RunProfile, RunState } from '../../electron/ipc-types';

interface RunProfileState {
  profiles: RunProfile[];
  runs: RunState[];  // 运行中实例（运行时态）
  setProfiles: (p: RunProfile[]) => void;
  upsertRun: (r: RunState) => void;   // onRunUpdate 收到时 upsert
  removeRun: (runId: string) => void;
  reset: () => void;
}

export const useRunProfileStore = create<RunProfileState>((set) => ({
  profiles: [],
  runs: [],
  setProfiles: (p) => set({ profiles: p }),
  upsertRun: (r) => set((s) => {
    const others = s.runs.filter((x) => x.runId !== r.runId);
    return { runs: [...others, r] };
  }),
  removeRun: (runId) => set((s) => ({ runs: s.runs.filter((x) => x.runId !== runId) })),
  reset: () => set({ profiles: [], runs: [] }),
}));
