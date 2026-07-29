import { create } from 'zustand';

export type PanelSource = 'port' | 'process' | 'perf' | 'snapshot';

interface FocusState {
  /** 全局聚焦的进程 PID（单值）。null=无聚焦。与 selectedPids（多选）独立（C）。 */
  focusedPid: number | null;
  /** 触发聚焦的来源面板（首版仅存储，用于调试/未来 UI 提示）。 */
  sourcePanel: PanelSource | null;
  /** 设聚焦。pid=null 清空（sourcePanel 一并清空）。 */
  focus: (pid: number | null, source?: PanelSource | null) => void;
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedPid: null,
  sourcePanel: null,
  focus: (pid, source = null) => set({ focusedPid: pid, sourcePanel: pid == null ? null : source }),
}));
