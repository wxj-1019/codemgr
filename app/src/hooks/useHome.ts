import { useEffect } from 'react';
import { useHomeStore } from '../store/homeStore';
import { useVisibilityStore, selectPollable } from '../store/visibilityStore';

const TICK_MS = 2000;

/**
 * 首页数据中枢轮询：挂载后每 2s 刷新一次 homeStore。
 * refresh 自驱分流（I1）：perf/process 面板可见时读共享 store 快照；面板未挂载
 * （classic=home 首屏）时 home 代为采样并写回共享 store，再经 IssueDetector
 * （跨轮 streak）→ healthAssess → 写入 homeStore。首帧立即刷新一次；卸载时停止
 * （running=false）。
 *
 * 可见性门控（M6）：home 面板已登记进 visibilityStore（visible.home），
 * pollable=false（面板被遮挡 / 窗口最小化）时停 interval（数据冻结），
 * 恢复可见时本 effect 因 pollable 变化重跑，立即补一次 refresh。
 * running 守卫保持 getState() 模式（cleanup 里 setRunning(false) 不订阅，
 * 避免触发依赖变化导致 effect 无限重跑）。
 */
export function useHome() {
  const setRunning = useHomeStore((s) => s.setRunning);
  const pollable = useVisibilityStore(selectPollable('home'));

  useEffect(() => {
    // 已有实例在轮询（running=true）时不叠加 interval。经 getState 读取而非订阅
    // running，避免 cleanup 里 setRunning(false) 触发依赖变化导致 effect 无限重跑。
    if (!pollable) return; // 不可见：不启动轮询（数据冻结，恢复可见时 effect 重跑）
    if (useHomeStore.getState().running) return;
    setRunning(true);
    const id = setInterval(() => { void useHomeStore.getState().refresh(); }, TICK_MS);
    void useHomeStore.getState().refresh(); // 首帧 / 恢复可见立即刷新（async，busy 防重入）
    return () => {
      clearInterval(id);
      useHomeStore.getState().setRunning(false);
    };
  }, [setRunning, pollable]);
}
