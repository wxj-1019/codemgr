import { create } from 'zustand';
import type { MosaicNode } from 'react-mosaic-component';
import { containsPanel, type PanelId } from './layoutStore';

export function firstPanelLeaf(root: MosaicNode<PanelId> | null): PanelId | null {
  if (root === null) return null;
  return typeof root === 'string' ? root : firstPanelLeaf(root.first);
}

interface ActivePanelState {
  activeId: PanelId | null;
  setActive: (id: PanelId) => void;
  reconcile: (root: MosaicNode<PanelId> | null) => void;
  reset: () => void;
}

export const useActivePanelStore = create<ActivePanelState>((set, get) => ({
  activeId: null,
  setActive: (id) => set({ activeId: id }),
  reconcile: (root) => {
    const activeId = get().activeId;
    if (activeId !== null && containsPanel(root, activeId)) return;
    set({ activeId: firstPanelLeaf(root) });
  },
  reset: () => set({ activeId: null }),
}));
