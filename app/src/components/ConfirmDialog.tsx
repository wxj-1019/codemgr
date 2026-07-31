import { type ReactNode } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';

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
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o && !busy) onCancel(); }}
      title={title}
      description={message}
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
        <Button
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="dangerQuiet"
          size="md"
          onClick={onConfirm}
          busy={busy}
          busyLabel="处理中…"
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
