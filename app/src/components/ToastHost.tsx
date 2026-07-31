import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore, type ToastKind } from '../store/toastStore';
import { IconButton } from './ui/IconButton';
import { CheckCircle2, CircleX, Info, X } from './icons';

const KIND_META: Record<ToastKind, { icon: ReactElement; iconCls: string; role: 'status' | 'alert'; accentCls: string }> = {
  success: { icon: <CheckCircle2 size={15} aria-hidden="true" />, iconCls: 'text-success', role: 'status', accentCls: 'bg-success' },
  error: { icon: <CircleX size={15} aria-hidden="true" />, iconCls: 'text-danger', role: 'alert', accentCls: 'bg-danger' },
  info: { icon: <Info size={15} aria-hidden="true" />, iconCls: 'text-accent', role: 'status', accentCls: 'bg-accent' },
};

interface ToastItemProps {
  toast: { id: number; kind: ToastKind; message: string };
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);
  const meta = KIND_META[toast.kind];

  const handleDismiss = () => {
    setExiting(true);
    // Fire dismiss immediately; the exit animation is best-effort visual feedback
    // (the element will be removed from the DOM when the store updates).
    onDismiss(toast.id);
  };

  return (
    <div
      role={meta.role}
      className={`glass-elevated flex items-center gap-2 overflow-hidden rounded-2xl shadow-2xl ${
        exiting ? 'toast-exit' : 'toast-enter'
      }`}
    >
      {/* Left accent bar */}
      <div className={`w-[3px] self-stretch ${meta.accentCls}`} />
      <div className="flex flex-1 items-center gap-2 px-3 py-2">
        <span className={`shrink-0 ${meta.iconCls}`}>{meta.icon}</span>
        <span className="min-w-0 flex-1 break-words text-sm text-fg-primary">{toast.message}</span>
        <IconButton label="关闭通知" size="xs" onClick={handleDismiss}><X /></IconButton>
      </div>
    </div>
  );
}

/**
 * Toast 堆叠宿主：右下角 fixed，z-70（高于 ContextMenu z-60）。
 * 单条可手动关闭；自动消失由 toastStore 的定时器负责（success/info 4s，error 8s）。
 * 进入：translateX(100%) → 0 + fade，退出：反向。
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  );
}
