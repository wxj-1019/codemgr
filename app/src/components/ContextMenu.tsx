import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** 危险操作（结束进程等）用红色文字。 */
  danger?: boolean;
  /** 分隔线后的项目组（渲染为上一条 hr）。 */
  dividerBefore?: boolean;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 受控的右键上下文菜单。用 position:fixed + 客户端坐标定位，避免被 overflow
 * 容器裁切。打开后监听全局 click/scroll/Esc 关闭；定位时按视口边界做翻转，
 * 防止菜单贴右/下边缘时溢出屏幕。
 *
 * z-60：高于 ConfirmDialog（z-50），但实际两者不同时出现（右键触发 kill 后，
 * 菜单先关再弹对话框）。
 */
export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 渲染后测自身尺寸，按视口边界修正位置。未定位前用传入坐标占位。
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) { setPos({ x, y }); return; }
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (x + rect.width > vw) nx = Math.max(0, vw - rect.width);
    if (y + rect.height > vh) ny = Math.max(0, vh - rect.height);
    setPos({ x: nx, y: ny });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // 点击菜单内部不关（由 item onClick 自行处理）
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    function onScroll() { onClose(); } // 滚动后坐标失效，直接关
    // mousedown 优先于 click，避免先触发底层行选中再关菜单的闪烁
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] min-w-[140px] rounded-md border border-base-600 bg-base-800 py-1 text-sm shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.dividerBefore && <hr className="my-1 border-base-700" />}
          <button
            role="menuitem"
            disabled={it.disabled}
            onClick={() => { it.onSelect(); onClose(); }}
            className={`block w-full px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40 hover:bg-base-700 ${
              it.danger ? 'text-red-400 hover:bg-red-950/40' : 'text-fg-primary'
            }`}
          >
            {it.label}
          </button>
        </div>
      ))}
    </div>
  );
}
