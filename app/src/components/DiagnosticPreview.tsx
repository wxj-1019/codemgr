import { useRef } from 'react';
import { Dialog } from './ui/Dialog';

// 诊断上下文预览弹窗（D）。显示脱敏后的 Markdown，提供复制/关闭。
// 基于通用 Dialog（portal + focus trap + Esc + 焦点恢复）。复制用 navigator.clipboard。
export function DiagnosticPreview({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  const copyBtnRef = useRef<HTMLButtonElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onClose();
    } catch {
      // clipboard 被阻断：留在弹窗让用户手动选中复制
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="诊断上下文（已脱敏）"
      initialFocusRef={copyBtnRef}
      widthClass="w-full max-w-2xl"
    >
      <pre className="max-h-[60vh] overflow-auto text-xs text-content-secondary break-all font-mono whitespace-pre-wrap">
        {text}
      </pre>
      <div className="mt-4 flex justify-end gap-2">
        <button
          ref={copyBtnRef}
          onClick={copy}
          className="rounded bg-accent px-4 py-1.5 text-sm text-on-accent hover:bg-accent/80"
        >
          复制到剪贴板
        </button>
        <button
          onClick={onClose}
          className="rounded border border-line px-4 py-1.5 text-sm text-content-secondary hover:bg-surface-raised"
        >
          关闭
        </button>
      </div>
    </Dialog>
  );
}