import { useEffect } from 'react';
import { ipc } from '../lib/ipc';
import { useRunProfileStore } from '../store/runProfileStore';
import type { RunState } from '../../electron/ipc-types';

/**
 * 挂载时拉 profiles + run 状态全量快照 + 订阅增量事件。卸载时取消订阅。
 *
 * UX-06 同步协议：先订阅事件，再拉全量快照。快照在途时收到的事件先入 buffer，
 * 快照落地后按序重放——快照之后的新事件自然覆盖快照，快照已含的旧事件重放无害
 * （run 状态单向推进：running → exited/failed 终态，同一 runId 重放不会回退）。
 * 这样"面板关闭期间 run 退出的事件丢失 → 重开显示陈旧 running"被修复，
 * 也不会丢失快照往返窗口内的新事件。
 */
export function useRunProfiles() {
  const setProfiles = useRunProfileStore((s) => s.setProfiles);
  const setRuns = useRunProfileStore((s) => s.setRuns);
  const upsertRun = useRunProfileStore((s) => s.upsertRun);

  useEffect(() => {
    let disposed = false;
    let synced = false;
    const buffered: RunState[] = [];
    const unsub = ipc.onRunUpdate((update) => {
      if (synced) { upsertRun(update); return; }
      buffered.push(update);
    });
    const finishSync = () => {
      synced = true;
      for (const u of buffered) upsertRun(u);
      buffered.length = 0;
    };
    ipc.listRunProfiles().then(setProfiles).catch(() => { /* ignore */ });
    ipc.getRunStates()
      .then((states) => {
        if (disposed) return;
        setRuns(states);
        finishSync();
      })
      // 快照拉取失败也不能丢事件：重放 buffer 后切直连（后续事件不丢）
      .catch(() => { if (!disposed) finishSync(); });
    return () => { disposed = true; unsub(); };
  }, [setProfiles, setRuns, upsertRun]);
}

/** 操作后刷新 profiles（save/delete 后调）。 */
export async function refreshProfiles() {
  const profiles = await ipc.listRunProfiles();
  useRunProfileStore.getState().setProfiles(profiles);
}
