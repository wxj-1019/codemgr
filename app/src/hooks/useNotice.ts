import { useCallback, useEffect, useRef, useState } from 'react';

export interface Notice {
  tone: 'success' | 'warning' | 'danger';
  text: string;
}

/**
 * 一次性操作反馈横幅：show 后展示 durationMs 毫秒自动消失；
 * 连续 show 重置计时（旧 timer 不会提前清掉新通知）。卸载时清理 timer。
 * 取代原生 alert 作为操作结果反馈（UX-03/UX-17）。
 */
export function useNotice(durationMs = 4000) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const show = useCallback((tone: Notice['tone'], text: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setNotice({ tone, text });
    timerRef.current = window.setTimeout(() => setNotice(null), durationMs);
  }, [durationMs]);

  return { notice, show };
}
