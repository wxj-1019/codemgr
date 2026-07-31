import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../icons';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** 打开时聚焦的元素（如确认按钮）。不提供则聚焦关闭按钮。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 进行中：禁用关闭/提交，防止连点。 */
  busy?: boolean;
  /** 是否显示右上角关闭按钮（默认 true）。 */
  showCloseButton?: boolean;
  /** 容器宽度类（默认 w-96）。 */
  widthClass?: string;
}

/**
 * 通用对话框：createPortal 到 document.body（避免被 .glass containing block 裁切），
 * 含 focus trap（Tab 循环在内）、Escape 关闭（非 busy）、焦点恢复（关闭后回到触发元素）、
 * aria-modal + aria-labelledby 完整语义。
 *
 * 设计依据：Phase 4 portal overlays（design §Phase 4 Dialog）。
 */
export function Dialog({
  open, onOpenChange, title, description, children,
  initialFocusRef, busy = false, showCloseButton = true, widthClass = 'w-[440px]',
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 记录打开前的焦点元素，关闭后恢复（accessibility 标准要求）
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // 记录触发元素
    previousFocusRef.current = document.activeElement as HTMLElement;

    // 聚焦初始元素（或面板本身，使 Tab 从面板内开始）
    const t = setTimeout(() => {
      (initialFocusRef?.current ?? panelRef.current)?.focus();
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      // Escape 关闭（busy 时禁用）
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      // Focus trap：Tab / Shift+Tab 在面板内循环
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKeyDown);
      // 恢复焦点到触发元素
      previousFocusRef.current?.focus();
    };
  }, [open, busy, onOpenChange, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="presentation"
      onClick={() => { if (!busy) onOpenChange(false); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`glass-elevated ${widthClass} dialog-enter max-h-[85vh] overflow-auto rounded-[20px] p-5 shadow-2xl outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-content-primary">{title}</h3>
            {description && (
              <p id={descId} className="mt-1 text-sm text-content-secondary">{description}</p>
            )}
          </div>
          {showCloseButton && (
            <IconButton
              label="关闭"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="-mr-1 -mt-1 shrink-0"
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}