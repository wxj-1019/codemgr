import { useEffect } from 'react';
import { ipc } from '../lib/ipc';
import { useRunProfileStore } from '../store/runProfileStore';

/** 挂载时拉 profiles + 订阅 run 状态事件。卸载时取消订阅。 */
export function useRunProfiles() {
  const setProfiles = useRunProfileStore((s) => s.setProfiles);
  const upsertRun = useRunProfileStore((s) => s.upsertRun);

  useEffect(() => {
    ipc.listRunProfiles().then(setProfiles).catch(() => { /* ignore */ });
    const unsub = ipc.onRunUpdate((update) => upsertRun(update));
    return () => unsub();
  }, [setProfiles, upsertRun]);
}

/** 操作后刷新 profiles（save/delete 后调）。 */
export async function refreshProfiles() {
  const profiles = await ipc.listRunProfiles();
  useRunProfileStore.getState().setProfiles(profiles);
}
