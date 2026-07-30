import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore, type ToastKind } from '../store/toastStore';
import { IconButton } from './ui/IconButton';
import { CheckCircle2, CircleX, Info, X } from './icons';

const KIND_META: Record<ToastKind, { icon: ReactElement; iconCls: string; role: 'status' | 'alert' }> = {
  success: { icon: <CheckCircle2 size={15} aria-hidden="true" />, iconCls: 'text-success', role: 'status' },
  error: { icon: <CircleX size={15} aria-hidden="true" />, iconCls: 'text-danger', role: 'alert' },
  info: { icon: <Info size={15} aria-hidden="true" />, iconCls: 'text-accent', role: 'status' },
};

/**
 * Toast 堆叠宿主：右下角 fixed，z-70（高于 ContextMenu z-60）。
 * 单条可手动关闭；自动消失由 toastStore 的定时器负责（success/info 4s，error 8s）。
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const meta = KIND_META[t.kind];
        return (
          <div
            key={t.id}
            role={meta.role}
            className="glass-elevated flex items-center gap-2 rounded-lg px-3 py-2 text-sm shadow-2xl"
          >
            <span className={`shrink-0 ${meta.iconCls}`}>{meta.icon}</span>
            <span className="min-w-0 flex-1 break-words text-fg-primary">{t.message}</span>
            <IconButton label="关闭通知" size="xs" onClick={() => dismiss(t.id)}><X /></IconButton>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
