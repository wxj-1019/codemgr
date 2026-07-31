import { createPortal } from 'react-dom';
import { useToastStore } from '../store/toastStore';
import { ToastItem } from './Toast';

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="fixed right-4 z-[9999] flex flex-col gap-2"
      style={{ top: 'calc(var(--topbar-height) + 12px)' }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  );
}
