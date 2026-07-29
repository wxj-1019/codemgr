import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useVisibilityStore } from '../store/visibilityStore';

/**
 * 追踪某面板 DOM 的可见性，写入全局可见性 store。
 *
 * mosaic 多面板挂载后，被遮挡/最小化/折叠的面板继续轮询会浪费 native 调用
 * 并制造采集尖刺（roadmap R2）。本 hook 用 IntersectionObserver 监测面板
 * 是否真正进入视口（threshold 极小，被遮/拖出视口即判不可见），并配合
 * document.visibilitychange 处理整窗最小化。
 *
 * 由 Panel 包装器调用：把面板根 div 的 ref 传进来。
 */
export function useVisibilityTracking(
  panelId: string,
  ref: RefObject<HTMLElement | null>,
): void {
  const setVisible = useVisibilityStore((s) => s.setVisible);
  const setWindowVisible = useVisibilityStore((s) => s.setWindowVisible);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // IntersectionObserver：面板进入视口才算可见。threshold 取小值，
    // 只要有一点可见即判可见（被完全遮挡/移出视口才停轮询）。
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // mosaic 折叠/展开会触发；取最近一次的可见比。
          setVisible(panelId, e.isIntersecting && e.intersectionRatio > 0);
        }
      },
      { threshold: [0, 0.01] },
    );
    io.observe(el);

    // 整窗最小化/切后台：document.hidden → 所有面板统一停轮询。
    const onVisChange = () => setWindowVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisChange);
    // 初始同步一次（hook 挂载时窗口可能已在后台）。
    setWindowVisible(!document.hidden);

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [panelId, ref, setVisible, setWindowVisible]);
}
