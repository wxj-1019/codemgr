import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
}

const MAX_TOASTS = 5;
const DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, warning: 4000, error: 8000 };

// 定时器句柄与 id 计数放模块级（不进 state，瞬态 UI 态不 persist）：
// dismiss/丢弃最旧时清理对应定时器，防泄漏。
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function clearTimer(id: number): void {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string) => number;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    const item: ToastItem = { id, kind, message, durationMs: DURATION[kind] };
    const kept = [...get().toasts, item];
    // 超上限丢弃最旧：连带清掉其自动消失定时器
    for (const d of kept.slice(0, Math.max(0, kept.length - MAX_TOASTS))) clearTimer(d.id);
    set({ toasts: kept.slice(-MAX_TOASTS) });
    timers.set(id, setTimeout(() => get().dismiss(id), item.durationMs));
    return id;
  },
  dismiss: (id) => {
    clearTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** 仅测试用：清空栈/定时器并重置 id 计数，防用例间泄漏。 */
export function __resetToastStoreForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  nextId = 1;
  useToastStore.setState({ toasts: [] });
}
