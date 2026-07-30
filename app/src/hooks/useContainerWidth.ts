import { useEffect, useState, type RefObject } from 'react';

/**
 * 用 ResizeObserver 测量容器宽度，返回当前像素宽度（未测量时为 null）。
 *
 * 用于"按面板 tile 宽度"做响应式决策（如侧栏显隐），替代 window.matchMedia
 * —— 因为多面板布局下，单个 tile 的宽度与窗口宽度无关（窗口很宽但某 tile 很窄）。
 * 卸载时自动断开 observer。
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 初始同步一次，避免首帧 null
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
