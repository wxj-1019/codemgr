import { useRef, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 进行中时禁用按钮，防止连点重复发起 kill。 */
  busy?: boolean;
  /** 可选：message 下方的目标明细（如进程清单），限高滚动（UX-01）。 */
  details?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 确认对话框：基于通用 Dialog（portal + focus trap + Esc + 焦点恢复）。
 * 保留确认/取消双按钮语义。打开时聚焦取消按钮（降低误触「结束」风险）。
 */
export function ConfirmDialog({
  open, title, message,
  confirmLabel = '确认', cancelLabel = '取消',
  busy = false,
  details,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o && !busy) onCancel(); }}
      title={title}
      description={message}
      initialFocusRef={cancelRef}
      busy={busy}
      widthClass="w-96"
      showCloseButton={false}
    >
      {details && (
        <div className="mb-3 max-h-36 overflow-auto whitespace-pre-line rounded-md border border-line bg-surface-overlay/60 p-2 font-mono text-[11px] leading-4 text-content-secondary">
          {details}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm text-content-primary hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg border border-danger/40 bg-transparent px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
