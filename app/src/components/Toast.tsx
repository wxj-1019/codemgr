import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import type { Toast as ToastData } from '../store/toastStore';
import { useToastStore } from '../store/toastStore';

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const;

const BORDER_COLORS = {
  success: 'border-l-success',
  error: 'border-l-danger',
  info: 'border-l-accent',
} as const;

export function ToastItem({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const Icon = ICONS[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`glass-elevated flex items-center gap-3 rounded-lg border-l-2 ${BORDER_COLORS[toast.type]} px-4 py-3 text-sm text-content-primary shadow-2xl animate-[slideIn_200ms_ease-out]`}
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1 truncate">{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-content-muted hover:text-content-primary transition-colors duration-150"
        aria-label="关闭通知"
      >
        <X size={14} />
      </button>
    </div>
  );
}
