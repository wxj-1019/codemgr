import { create } from 'zustand';

/**
 * 聚焦面板追踪（Aurora UI v1.2 P3）：记录用户最后点击的面板，
 * Panel 组件据此挂 .panel-active（Siri 辉光描边）。
 * 不 persist——聚焦是瞬态，刷新后回到无聚焦。
 */
interface ActivePanelState {
  activeId: string | null;
  setActive: (id: string) => void;
  reset: () => void;
}

export const useActivePanelStore = create<ActivePanelState>((set) => ({
  activeId: null,
  setActive: (id) => set({ activeId: id }),
  reset: () => set({ activeId: null }),
}));
