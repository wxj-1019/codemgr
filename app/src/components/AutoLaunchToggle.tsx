import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';

/**
 * 开机自启开关（nav 工具栏按钮）。
 * 挂载时从 main 读取当前 login item 状态；切换时乐观更新 UI，
 * 以 setAutoLaunch 返回的实际状态为准回写（失败即回滚）。
 */
export function AutoLaunchToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ipc.getAutoLaunch().then(setEnabled).catch(() => { /* 读取失败保持关闭态，非关键 */ });
  }, []);

  const toggle = async () => {
    if (busy) return;
    const next = !enabled;
    setEnabled(next); // 乐观更新
    setBusy(true);
    try {
      // 以 main 返回的实际状态为准（setLoginItemSettings 失败时自然回滚）
      setEnabled(await ipc.setAutoLaunch(next));
    } catch {
      setEnabled(!next); // IPC 层异常：回滚
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`px-3 py-2 text-sm transition-colors ${
        enabled ? 'text-accent' : 'text-fg-secondary hover:text-fg-primary'
      }`}
      role="switch"
      aria-checked={enabled}
      aria-label="开机自启"
      title={enabled ? '开机自启：已开启' : '开机自启：已关闭'}
    >
      {enabled ? '自启 · 开' : '自启'}
    </button>
  );
}
