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

/** 内置三大面板的 id。 */
export type BuiltInPanelId = 'port' | 'process' | 'perf';

/**
 * mosaic 二叉树的叶子类型。内置面板是固定字面量；插件视图是 `plugin:<id>` 模板字面量
 * （6b 第二步：插件贡献的可视面板作为 mosaic tile）。模板字面量保留编译期区分内置/插件
 * 的能力（renderTile 用类型守卫收窄）。
 */
export type PanelId = BuiltInPanelId | `plugin:${string}`;

/** 类型守卫：是否为内置面板 id。 */
export function isBuiltInPanel(id: string): id is BuiltInPanelId {
  return id === 'port' || id === 'process' || id === 'perf';
}

/** 类型守卫：是否为插件视图面板 id（`plugin:<id>` 形式）。 */
export function isPluginPanel(id: string): id is `plugin:${string}` {
  return id.startsWith('plugin:');
}

/** 从 `plugin:<id>` 提取插件 id 部分；非插件 id 返回 null。 */
export function pluginIdOf(id: string): string | null {
  return isPluginPanel(id) ? id.slice('plugin:'.length) : null;
}

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
  /** 把插件面板插入当前布局（在树右侧 split，无树则作为根）。 */
  addPluginPanel: (panelId: `plugin:${string}`) => void;
  /** 测试辅助：恢复默认。 */
  reset: () => void;
}

/**
 * 过滤布局树中不在 validPluginIds 里的 `plugin:*` 悬空叶子。
 * 插件被移除后，持久化的树可能引用不存在的插件 → 启动时调用此函数清理。
 * 内置面板叶子不受影响。若过滤后某分支只剩一个子节点，提升该子节点替代父节点
 * （避免退化成单子分支）。整棵树都悬空则返回 null（触发 zero-state）。
 */
export function prunePluginLeaves(
  node: MosaicNode<PanelId> | null,
  validPluginIds: Set<string>,
): MosaicNode<PanelId> | null {
  if (!node) return null;
  if (typeof node === 'string') {
    const pid = pluginIdOf(node);
    // 内置面板保留；插件面板仅当 id 在 validPluginIds 里时保留
    if (pid === null || validPluginIds.has(pid)) return node;
    return null; // 悬空插件叶子
  }
  const first = prunePluginLeaves(node.first, validPluginIds);
  const second = prunePluginLeaves(node.second, validPluginIds);
  // 两子都存活 → 保留分支
  if (first !== null && second !== null) {
    return { direction: node.direction, first, second, splitPercentage: node.splitPercentage };
  }
  // 只一子存活 → 提升该子（消除单子分支）
  return first ?? second;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      root: LAYOUT_PRESETS.classic,
      preset: 'classic',

      setRoot: (n) => set({ root: n }),
      applyPreset: (id) => set({ root: LAYOUT_PRESETS[id], preset: id }),
      addPluginPanel: (panelId) => set((s) => ({
        // 无树 → 插件作为根；有树 → 右侧 split（原树占左，插件占右 30%）
        root: s.root === null
          ? panelId
          : { direction: 'row' as const, first: s.root, second: panelId, splitPercentage: 70 },
      })),
      reset: () => set({ root: LAYOUT_PRESETS.classic, preset: 'classic' }),
    }),
    {
      name: 'codemgr:layout',
      // 只持久化布局树 + 预设；setter 是函数不存。
      partialize: (s) => ({ root: s.root, preset: s.preset }),
    },
  ),
);
