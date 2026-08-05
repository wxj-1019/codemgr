import { useEffect } from 'react';
import { useHomeStore } from '../store/homeStore';

const TICK_MS = 2000;

/**
 * 首页数据中枢轮询：挂载后每 2s 从 perfStore/processPanelStore 读快照，
 * 经 IssueDetector（跨轮 streak）→ healthAssess → 写入 homeStore。
 * 首帧立即计算一次；卸载时停止（running=false）。
 *
 * 可见性暂停说明：visibilityStore.selectPollable 仅对已登记的可见面板
 * （port/process/perf/snapshot）有意义，home 面板尚未登记 → selectPollable('home')
 * 恒为 false，接入会直接停轮询，故本 hook 暂不接可见性节流，固定 2s tick。
 */
export function useHome() {
  const setRunning = useHomeStore((s) => s.setRunning);

  useEffect(() => {
    // 已有实例在轮询（running=true）时不叠加 interval。经 getState 读取而非订阅
    // running，避免 cleanup 里 setRunning(false) 触发依赖变化导致 effect 无限重跑。
    if (useHomeStore.getState().running) return;
    setRunning(true);
    const id = setInterval(() => useHomeStore.getState().refresh(), TICK_MS);
    useHomeStore.getState().refresh(); // 首帧立即计算
    return () => {
      clearInterval(id);
      useHomeStore.getState().setRunning(false);
    };
  }, [setRunning]);
}
