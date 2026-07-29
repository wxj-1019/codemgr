import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ipc } from '../lib/ipc';
import type { SnapshotEntry, SnapshotMeta, ProcessSnapshot } from '../../electron/ipc-types';

/**
 * 进程快照对比 store（v2.2，spec §2.2）。
 *
 * 仅持有「运行时态」：快照列表元信息（不含 entries，避免内存膨胀）、当前选中 id、
 * loading/error。完整 entries 在用户选中某个快照对比时按需 loadSnapshot 拉取
 * （UI 持 local state，不入 store——entries 数百条每秒级刷新不需要跨组件共享）。
 *
 * 不 persist 快照数据本身（持久化在 userData/snapshots/*.json，文件是事实来源）。
 * 只 persist selectedId（用户上次选中的快照，重启后自动恢复选中——UX 细节）。
 */

interface SnapshotState {
  /** 快照列表元信息（list 通道返回，不含 entries）。createdAt 倒序由 main 保证。 */
  snapshots: SnapshotMeta[];
  /** 当前选中的快照 id（UI 高亮 + 对比基准）。null = 未选。 */
  selectedId: string | null;
  loading: boolean;
  error: string | null;

  fetchList: () => Promise<void>;
  /** 保存快照。返完整快照（含 main 生成的 id）或 null（失败/超上限）。成功后刷新 list。 */
  save: (name: string, entries: SnapshotEntry[]) => Promise<ProcessSnapshot | null>;
  /** 删除快照。成功后刷新 list；若删的是当前选中则清空 selectedId。 */
  remove: (id: string) => Promise<boolean>;
  /** 选中某快照（或 null 清空）。 */
  select: (id: string | null) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set) => ({
      snapshots: [],
      selectedId: null,
      loading: false,
      error: null,

      fetchList: async () => {
        set({ loading: true, error: null });
        try {
          const list = await ipc.listSnapshots();
          set({ snapshots: list, loading: false });
        } catch (e) {
          set({ loading: false, error: String(e) });
        }
      },

      save: async (name, entries) => {
        set({ loading: true, error: null });
        try {
          const snap = await ipc.saveSnapshot(name, entries);
          if (!snap) {
            // null = 校验失败 / 超 20 上限 / 写盘失败。main 已 console.error，
            // 这里给用户可读错误（超上限提示删旧）。
            set({ loading: false, error: '保存失败：可能已超过 20 个快照上限，请删除旧快照后重试' });
            return null;
          }
          // 成功 → 刷新列表（拿最新元信息 + 新 id 入列）
          const list = await ipc.listSnapshots();
          set({ snapshots: list, loading: false, error: null, selectedId: snap.id });
          return snap;
        } catch (e) {
          set({ loading: false, error: String(e) });
          return null;
        }
      },

      remove: async (id) => {
        set({ loading: true, error: null });
        try {
          const ok = await ipc.deleteSnapshot(id);
          if (!ok) {
            set({ loading: false, error: '删除失败：快照可能已不存在' });
            return false;
          }
          // 成功 → 刷新列表 + 若删的是当前选中则清空
          const list = await ipc.listSnapshots();
          set((s) => ({
            snapshots: list,
            loading: false,
            error: null,
            selectedId: s.selectedId === id ? null : s.selectedId,
          }));
          return true;
        } catch (e) {
          set({ loading: false, error: String(e) });
          return false;
        }
      },

      select: (id) => set({ selectedId: id }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set({ error: e }),
      reset: () => set({ snapshots: [], selectedId: null, loading: false, error: null }),
    }),
    {
      name: 'codemgr:snapshot',
      // 只 persist selectedId（用户上次选中的快照，重启后自动恢复——UX 细节）。
      // snapshots/loading/error 是运行时态，首屏由 fetchList 重新拉。
      partialize: (s) => ({ selectedId: s.selectedId }),
    },
  ),
);
