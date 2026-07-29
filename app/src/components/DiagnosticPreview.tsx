import { useEffect, useRef } from 'react';

// 诊断上下文预览弹窗（D）。显示脱敏后的 Markdown，提供复制/关闭。
// 简单模态：Escape 关闭，初始焦点在复制按钮。复制用 navigator.clipboard。
export function DiagnosticPreview({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  const copyBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    copyBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onClose();
    } catch {
      // clipboard 被阻断：留在弹窗让用户手动选中复制
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-base-600 bg-base-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-base-600 px-4 py-3">
          <h3 className="text-sm font-semibold text-fg-primary">诊断上下文（已脱敏）</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-primary" aria-label="关闭">✕</button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-xs text-fg-secondary break-all font-mono whitespace-pre-wrap">
          {text}
        </pre>
        <div className="flex justify-end gap-2 border-t border-base-600 p-3">
          <button
            ref={copyBtnRef}
            onClick={copy}
            className="rounded bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent/80"
          >
            复制到剪贴板
          </button>
          <button
            onClick={onClose}
            className="rounded border border-base-600 px-4 py-1.5 text-sm text-fg-secondary hover:bg-base-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
