import { create } from 'zustand';

/**
 * 面板可见性运行时状态（不持久化）。
 *
 * 多面板同时挂载时，三个轮询器（perf 1s / process 2s / port 3s）并发会与
 * native 采集竞争产生尖刺（roadmap R2）。用全局可见性 store 广播各面板的
 * 可见状态：不可见的面板由各自的轮询 hook 停掉 interval，可见时再恢复。
 * 插件视图面板（6b 第二步）也接入此节流——不可见的插件 tile 停推快照。
 *
 * 两个可见性来源（取交集，详见 useVisibilityTracking）：
 *  - IntersectionObserver：面板被遮挡/最小化/在视口外 → false
 *  - document.visibilitychange：整个窗口最小化/切到后台 → 所有面板 false
 */
interface VisibilityState {
  /** 各面板当前是否"值得轮询"（在视口内 + 窗口在前台）。键含内置面板 + 运行时插件面板。 */
  visible: Record<string, boolean>;
  /** 写入单个面板的可见性（由 useVisibilityTracking 调用）。 */
  setVisible: (id: string, v: boolean) => void;
  /** 窗口级可见性（visibilitychange）：为 false 时所有面板统一判不可见。 */
  windowVisible: boolean;
  setWindowVisible: (v: boolean) => void;
}

export const useVisibilityStore = create<VisibilityState>((set) => ({
  // v2.2 加 'snapshot'：快照面板本身不轮询（spec §2.4 明确不加 interval），但保持
  // visible map 一致——后续若加按需刷新节流也走同一可见性入口。
  // steward home 加 'home'：首页数据中枢（2s tick）接入同一可见性门控（M6）。
  visible: { home: true, port: true, process: true, perf: true, snapshot: true },
  setVisible: (id, v) =>
    set((s) => (s.visible[id] === v ? s : { visible: { ...s.visible, [id]: v } })),
  windowVisible: true,
  setWindowVisible: (v) => set({ windowVisible: v }),
}));

/**
 * 某面板是否"值得轮询"：面板自身可见 && 窗口在前台。
 * 轮询 hook 用选择器订阅这个派生值。
 */
export function selectPollable(id: string) {
  return (s: VisibilityState) => s.windowVisible && !!s.visible[id];
}
