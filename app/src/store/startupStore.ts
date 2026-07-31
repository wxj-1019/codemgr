// 启动项面板状态（子项目 G）：手动刷新（无轮询）+ 乐观启停（失败回滚 + toast）。
import { create } from 'zustand';
import type { StartupItem } from '../../electron/ipc-types';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';

interface StartupState {
  items: StartupItem[];
  loading: boolean;
  error: string | null;
  toggling: ReadonlySet<string>;
  refresh: () => Promise<void>;
  toggle: (id: string) => Promise<void>;
}

export const useStartupStore = create<StartupState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  toggling: new Set(),
  refresh: async () => {
    set({ loading: true });
    try {
      const items = await ipc.listStartupItems();
      set({ items, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  toggle: async (id) => {
    const { toggling, items } = get();
    if (toggling.has(id)) return;
    const target = items.find((x) => x.id === id);
    if (!target) return;
    // 乐观翻转；失败回滚 + toast
    set({
      toggling: new Set([...toggling, id]),
      items: items.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
    });
    try {
      const err = await ipc.setStartupItemEnabled(id, !target.enabled);
      if (err) {
        set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, enabled: target.enabled } : x)) }));
        notify.error(err);
      } else {
        await get().refresh(); // 成功后重采对齐（文件夹项 id 随后缀变化）
      }
    } catch (e) {
      set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, enabled: target.enabled } : x)) }));
      notify.error(String(e));
    } finally {
      set((s) => ({ toggling: new Set([...s.toggling].filter((x) => x !== id)) }));
    }
  },
}));
