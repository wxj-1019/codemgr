import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useVisibilityTracking } from '../hooks/useVisibilityTracking';
import type { PanelId } from '../store/layoutStore';

/**
 * 面板包装器：把 PortRadar/ProcessPanel/PerfPanel 包一层。
 *
 * 职责：提供尺寸容器（mosaic pane 内铺满）+ 可见性追踪（IntersectionObserver
 * 监测本面板是否进入视口，写入 visibilityStore，驱动轮询节流）。
 *
 * 不含标题栏——标题栏由外层 MosaicWindow 提供（拖拽手柄 + 控制按钮）。
 */
export function Panel({ id, children }: { id: PanelId; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useVisibilityTracking(id, ref);
  return (
    <div ref={ref} className="h-full w-full overflow-hidden bg-base-800">
      {children}
    </div>
  );
}
