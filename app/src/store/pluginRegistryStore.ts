import { create } from 'zustand';
import type { PluginManifestEntry } from '../../electron/ipc-types';

/**
 * 插件 manifest 注册表（运行时态，不持久化）。
 *
 * 共享数据源：PluginHost 加载 manifest 后写入，App.tsx 的"添加面板"下拉和
 * 悬空叶子清理都读它。避免 PluginHost / App / PluginPanel 各自重复拉 manifest。
 *
 * loaded：是否已拉取（避免清理逻辑在 manifest 未就绪时误删插件叶子）。
 */
interface PluginRegistryState {
  entries: PluginManifestEntry[];
  loaded: boolean;
  setEntries: (entries: PluginManifestEntry[]) => void;
  /** 按 id 查找插件条目（PluginPanel 查 src/title 用）。 */
  find: (id: string) => PluginManifestEntry | undefined;
  /** 所有插件 id 的集合（prunePluginLeaves 的 validPluginIds 参数用）。 */
  ids: () => Set<string>;
}

export const usePluginRegistryStore = create<PluginRegistryState>((set, get) => ({
  entries: [],
  loaded: false,
  setEntries: (entries) => set({ entries, loaded: true }),
  find: (id) => get().entries.find((e) => e.id === id),
  ids: () => new Set(get().entries.map((e) => e.id)),
}));
