import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useVisibilityTracking } from '../hooks/useVisibilityTracking';

/**
 * 面板包装器：把 PortRadar/ProcessPanel/PerfPanel/PluginPanel 包一层。
 *
 * 职责：提供尺寸容器（mosaic pane 内铺满）+ 可见性追踪（IntersectionObserver
 * 监测本面板是否进入视口，写入 visibilityStore，驱动轮询节流）。
 *
 * 不含标题栏——标题栏由外层 MosaicWindow 提供（拖拽手柄 + 控制按钮）。
 */
export function Panel({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useVisibilityTracking(id, ref);
  return (
    <div ref={ref} className="glass h-full w-full overflow-hidden rounded-[14px]">
      {children}
    </div>
  );
}
