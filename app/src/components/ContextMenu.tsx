import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** 危险操作（结束进程等）用 danger（柔玫瑰）文字。 */
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
 * 键盘导航（roving tabindex）：打开时焦点落第一个可用项，↑/↓ 循环移动
 * （跳过 disabled），Home/End 跳首尾，Enter/Space 触发焦点项。
 *
 * z-60：高于 ConfirmDialog（z-50），但实际两者不同时出现（右键触发 kill 后，
 * 菜单先关再弹对话框）。
 */
export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 渲染后测自身尺寸，按视口边界修正位置。未定位前用传入坐标占位。
  const [pos, setPos] = useState({ x, y });

  // ── 键盘导航（复用 v1.6 纯导航模型：roving tabindex + 焦点与触发分离）──
  // 与表格不同：菜单 ↑/↓ 循环回卷，且跳过 disabled 项。
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // 可用（非禁用）项下标列表。items 变化时重算。
  const enabledIdxs = useMemo(
    () => items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0),
    [items],
  );
  // items 在父组件每次渲染都可能重建（如 ProcessTable 按 menu.proc 动态构造），
  // 因此"打开时聚焦首项"的 effect 只挂在 open 上，经 ref 读最新 enabledIdxs——
  // 否则打开期间父组件重渲染会把键盘焦点重置回首项。
  const enabledRef = useRef(enabledIdxs);
  enabledRef.current = enabledIdxs;

  // 打开时焦点落在第一个可用项
  useEffect(() => {
    if (open) setFocusIdx(enabledRef.current[0] ?? null);
  }, [open]);

  // 焦点项变化时同步 DOM focus（roving tabindex 配套）
  useEffect(() => {
    if (!open || focusIdx == null) return;
    const btn = ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')[focusIdx];
    btn?.focus();
  }, [open, focusIdx]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const enabled = enabledIdxs;
    if (enabled.length === 0) return;
    const cur = focusIdx == null ? -1 : enabled.indexOf(focusIdx);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(enabled[(cur + 1) % enabled.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(enabled[(cur - 1 + enabled.length) % enabled.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIdx(enabled[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusIdx(enabled[enabled.length - 1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      // preventDefault：阻止 Enter 触发原生 button click（避免 onSelect 双触发）
      // 及 Space 的页面滚动。触发后菜单关闭，Space keyup 的原生 click 落在已卸载节点上。
      e.preventDefault();
      if (focusIdx != null) {
        itemsRef.current[focusIdx].onSelect();
        onClose();
      }
    }
    // Escape 由全局 keydown 监听统一处理（保持原有行为）
  }

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
  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onMenuKeyDown}
      className="glass-elevated menu-enter fixed z-[60] min-w-[140px] rounded-2xl py-1 text-sm shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.dividerBefore && <hr className="my-1 border-line" />}
          <button
            role="menuitem"
            disabled={it.disabled}
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => { it.onSelect(); onClose(); }}
            className={`block w-full px-3 py-1.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-accent/10 ${
              it.danger ? 'text-danger hover:bg-danger/10' : 'text-content-primary'
            }`}
          >
            {it.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}