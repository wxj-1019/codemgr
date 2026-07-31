import { create } from 'zustand';
import type { RunProfile, RunState } from '../../electron/ipc-types';

interface RunProfileState {
  profiles: RunProfile[];
  runs: RunState[];  // 运行中实例（运行时态）
  /** 列表加载失败原因（UX-16b）：不再静默吞掉误报「尚无配置」。 */
  loadError: string | null;
  setProfiles: (p: RunProfile[]) => void;
  setRuns: (r: RunState[]) => void;  // 全量快照替换（UX-06：挂载同步用）
  upsertRun: (r: RunState) => void;   // onRunUpdate 收到时 upsert
  removeRun: (runId: string) => void;
  setLoadError: (e: string | null) => void;
  reset: () => void;
}

export const useRunProfileStore = create<RunProfileState>((set) => ({
  profiles: [],
  runs: [],
  loadError: null,
  setProfiles: (p) => set({ profiles: p }),
  setRuns: (r) => set({ runs: r }),
  upsertRun: (r) => set((s) => {
    const others = s.runs.filter((x) => x.runId !== r.runId);
    return { runs: [...others, r] };
  }),
  removeRun: (runId) => set((s) => ({ runs: s.runs.filter((x) => x.runId !== runId) })),
  setLoadError: (e) => set({ loadError: e }),
  reset: () => set({ profiles: [], runs: [], loadError: null }),
}));
