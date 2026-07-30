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

/** 内置面板的 id（v2.2 新增 'snapshot'；E2 新增 'sessions'；F1 新增 'run-profiles'）。 */
export type BuiltInPanelId = 'port' | 'process' | 'perf' | 'snapshot' | 'sessions' | 'run-profiles';

/**
 * mosaic 二叉树的叶子类型。内置面板是固定字面量；插件视图是 `plugin:<id>` 模板字面量
 * （6b 第二步：插件贡献的可视面板作为 mosaic tile）。模板字面量保留编译期区分内置/插件
 * 的能力（renderTile 用类型守卫收窄）。
 */
export type PanelId = BuiltInPanelId | `plugin:${string}`;

/** 类型守卫：是否为内置面板 id。 */
export function isBuiltInPanel(id: string): id is BuiltInPanelId {
  return id === 'port' || id === 'process' || id === 'perf' || id === 'snapshot' || id === 'sessions' || id === 'run-profiles';
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

/** 布局树是否已包含指定面板。 */
export function containsPanel(node: MosaicNode<PanelId> | null, id: PanelId): boolean {
  if (node === null) return false;
  if (typeof node === 'string') return node === id;
  return containsPanel(node.first, id) || containsPanel(node.second, id);
}

/** 打开面板后的纯布局转换；已存在时保留原树引用。 */
export function openPanelRoot(
  root: MosaicNode<PanelId> | null,
  panelId: PanelId,
): MosaicNode<PanelId> {
  if (containsPanel(root, panelId)) return root as MosaicNode<PanelId>;
  return root === null
    ? panelId
    : { direction: 'row', first: root, second: panelId, splitPercentage: 70 };
}

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

function layoutNodesEqual(
  left: MosaicNode<PanelId> | null,
  right: MosaicNode<PanelId> | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return left.direction === right.direction
    && left.splitPercentage === right.splitPercentage
    && layoutNodesEqual(left.first, right.first)
    && layoutNodesEqual(left.second, right.second);
}

function isPresetId(value: unknown): value is PresetId {
  return value === 'classic' || value === 'port-perf' || value === 'dev-focus';
}

export function sanitizeLayoutRoot(
  root: MosaicNode<PanelId> | null,
  seen: Set<PanelId> = new Set(),
): MosaicNode<PanelId> | null {
  if (root === null) return null;
  if (typeof root === 'string') {
    if (seen.has(root)) return null;
    seen.add(root);
    return root;
  }

  const first = sanitizeLayoutRoot(root.first, seen);
  const second = sanitizeLayoutRoot(root.second, seen);
  if (first !== null && second !== null) {
    return {
      direction: root.direction,
      first,
      second,
      splitPercentage: root.splitPercentage,
    };
  }
  return first ?? second;
}

function migrateLayoutState(persistedState: unknown, version: number): unknown {
  if (version !== 0 || !persistedState || typeof persistedState !== 'object') {
    return persistedState;
  }
  const state = persistedState as {
    root?: MosaicNode<PanelId> | null;
    preset?: unknown;
  };
  const root = sanitizeLayoutRoot(state.root ?? null);
  const preset = isPresetId(state.preset) ? state.preset : null;
  return {
    ...state,
    root,
    preset: preset !== null && layoutNodesEqual(root, LAYOUT_PRESETS[preset])
      ? preset
      : null,
  };
}

interface LayoutState {
  /** mosaic 二叉树根。null = 空布局（用户关掉所有面板，显示 zero-state）。 */
  root: MosaicNode<PanelId> | null;
  /** 当前激活的预设。手动修改布局后为 null。 */
  preset: PresetId | null;
  /** 受控写入树（mosaic onChange / 拖拽回报）。null 清空并脱离预设。 */
  setRoot: (n: MosaicNode<PanelId> | null) => void;
  /** 应用预设（覆盖当前树并保持对应预设）。 */
  applyPreset: (id: PresetId) => void;
  /** 打开面板；已存在时幂等，否则在当前树右侧按 70:30 插入。 */
  openPanel: (panelId: PanelId) => void;
  /** 把插件面板插入当前布局（兼容旧调用方）。 */
  addPluginPanel: (panelId: `plugin:${string}`) => void;
  /** 测试辅助：恢复默认。 */
  reset: () => void;
}

function openPanelState(
  state: LayoutState,
  panelId: PanelId,
): LayoutState | Pick<LayoutState, 'root' | 'preset'> {
  const root = openPanelRoot(state.root, panelId);
  return root === state.root ? state : { root, preset: null };
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

      setRoot: (n) => set({ root: n, preset: null }),
      applyPreset: (id) => set({ root: LAYOUT_PRESETS[id], preset: id }),
      openPanel: (panelId) => set((s) => openPanelState(s, panelId)),
      addPluginPanel: (panelId) => set((s) => openPanelState(s, panelId)),
      reset: () => set({ root: LAYOUT_PRESETS.classic, preset: 'classic' }),
    }),
    {
      name: 'codemgr:layout',
      version: 1,
      migrate: migrateLayoutState,
      // 只持久化布局树 + 预设；setter 是函数不存。
      partialize: (s) => ({ root: s.root, preset: s.preset }),
    },
  ),
);
