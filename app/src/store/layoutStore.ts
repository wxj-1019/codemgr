import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MosaicNode } from 'react-mosaic-component';

/**
 * 全局面板布局（react-mosaic 二叉树）。
 *
 * mosaic 把"面板树"建模成一棵二叉树：叶子是 PanelId，分支节点是
 * MosaicParent（direction + first/second 子树 + splitPercentage）。
 * 这棵树可直接序列化进 localStorage，刷新后恢复，自由拆分/嵌套/最小化。
 *
 * 设计依据：spec D1（react-mosaic-component，二叉树与持久化天然吻合）。
 */

/** 三大顶层面板的 id，也是 mosaic 二叉树的叶子类型。 */
export type PanelId = 'port' | 'process' | 'perf';

/** 预设布局的 id。 */
export type PresetId = 'classic' | 'port-perf' | 'dev-focus';

/** 预设：固定树结构，由 applyPreset 写入。 */
export const LAYOUT_PRESETS: Record<PresetId, MosaicNode<PanelId>> = {
  // classic：单面板进程占满 —— 等同旧 Tab 默认体验，渐进式过渡。
  classic: 'process',
  // port-perf：端口左 + 性能右，水平 5:5。最常用的"监控两件事"布局。
  'port-perf': {
    direction: 'row',
    first: 'port',
    second: 'perf',
    splitPercentage: 50,
  },
  // dev-focus：左进程 70% + 右上下分（上端口下性能）——嵌套树示例，开发主战场。
  'dev-focus': {
    direction: 'row',
    first: 'process',
    splitPercentage: 70,
    second: {
      direction: 'column',
      first: 'port',
      second: 'perf',
      splitPercentage: 50,
    },
  },
};

interface LayoutState {
  /** mosaic 二叉树根。null = 空布局（用户关掉所有面板，显示 zero-state）。 */
  root: MosaicNode<PanelId> | null;
  /** 当前激活的预设。手动 setRoot 后语义上"脱离预设"，但字段保留最近预设用于 UI 高亮。 */
  preset: PresetId;
  /** 受控写入树（mosaic onChange / 拖拽回报）。null 清空。 */
  setRoot: (n: MosaicNode<PanelId> | null) => void;
  /** 应用预设（覆盖当前树）。 */
  applyPreset: (id: PresetId) => void;
  /** 测试辅助：恢复默认。 */
  reset: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      root: LAYOUT_PRESETS.classic,
      preset: 'classic',

      setRoot: (n) => set({ root: n }),
      applyPreset: (id) => set({ root: LAYOUT_PRESETS[id], preset: id }),
      reset: () => set({ root: LAYOUT_PRESETS.classic, preset: 'classic' }),
    }),
    {
      name: 'codemgr:layout',
      // 只持久化布局树 + 预设；setter 是函数不存。
      partialize: (s) => ({ root: s.root, preset: s.preset }),
    },
  ),
);
