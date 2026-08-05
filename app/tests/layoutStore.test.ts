import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAYOUT_PRESETS,
  MAX_VISIBLE_PANELS,
  getPanelLeaves,
  limitVisiblePanels,
  openFocusedPanelRoot,
  validatePersistedRoot,
  replacedPanelOf,
  useLayoutStore,
  type PanelId,
} from '../src/store/layoutStore';
import type { MosaicNode } from 'react-mosaic-component';

describe('layoutStore', () => {
  // persist middleware reads/writes localStorage; clear it before each test so
  // rehydrated state from a prior test can't leak in (reset() alone re-persists).
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.getState().reset();
  });

  it('defaults to the classic preset (home fills the screen)', () => {
    const s = useLayoutStore.getState();
    expect(s.root).toBe('home');
    expect(s.preset).toBe('classic');
  });

  it('applyPreset("port-perf") splits port | perf 50:50 horizontally', () => {
    useLayoutStore.getState().applyPreset('port-perf');
    const s = useLayoutStore.getState();
    expect(s.preset).toBe('port-perf');
    expect(s.root).toEqual({
      direction: 'row',
      first: 'port',
      second: 'perf',
      splitPercentage: 50,
    });
  });

  it('applyPreset("dev-focus") nests port/perf under process', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    const expected: MosaicNode<PanelId> = {
      direction: 'row',
      first: 'process',
      splitPercentage: 70,
      second: {
        direction: 'column',
        first: 'port',
        second: 'perf',
        splitPercentage: 50,
      },
    };
    expect(useLayoutStore.getState().root).toEqual(expected);
    expect(useLayoutStore.getState().preset).toBe('dev-focus');
  });

  it('applyPreset("classic") restores single home panel', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    useLayoutStore.getState().applyPreset('classic');
    expect(useLayoutStore.getState().root).toBe('home');
    expect(useLayoutStore.getState().preset).toBe('classic');
  });

  it('setRoot overrides the tree (e.g. after a mosaic drag) and drops preset sync', () => {
    // 用户拖拽后 mosaic 回报新树；setRoot 应直接写入，不依赖预设。
    const drag: MosaicNode<PanelId> = {
      direction: 'column',
      first: 'port',
      second: 'process',
      splitPercentage: 40,
    };
    useLayoutStore.getState().setRoot(drag);
    expect(useLayoutStore.getState().root).toEqual(drag);
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('setRoot(null) clears the layout (zero-state)', () => {
    useLayoutStore.getState().setRoot(null);
    expect(useLayoutStore.getState().root).toBeNull();
  });

  it('applyPreset after a manual setRoot overwrites the custom tree', () => {
    useLayoutStore.getState().setRoot('port');
    useLayoutStore.getState().applyPreset('port-perf');
    expect(useLayoutStore.getState().root).toEqual({
      direction: 'row',
      first: 'port',
      second: 'perf',
      splitPercentage: 50,
    });
  });

  it('openPanel creates a leaf when the layout is empty', () => {
    useLayoutStore.getState().setRoot(null);
    useLayoutStore.getState().openPanel('snapshot');

    expect(useLayoutStore.getState().root).toBe('snapshot');
  });

  it('openPanel inserts a missing panel on the right with a 70:30 row split', () => {
    useLayoutStore.getState().setRoot('process');
    useLayoutStore.getState().openPanel('sessions');

    expect(useLayoutStore.getState().root).toEqual({
      direction: 'row',
      first: 'process',
      second: 'sessions',
      splitPercentage: 70,
    });
  });

  it('openPanel is idempotent when the panel already exists in a nested tree', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    const before = useLayoutStore.getState().root;

    useLayoutStore.getState().openPanel('perf');

    expect(useLayoutStore.getState().root).toBe(before);
    expect(useLayoutStore.getState().preset).toBe('dev-focus');
  });

  it('addPluginPanel creates a leaf when the layout is empty', () => {
    useLayoutStore.getState().setRoot(null);
    useLayoutStore.getState().addPluginPanel('plugin:disk-volumes');

    expect(useLayoutStore.getState().root).toBe('plugin:disk-volumes');
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('addPluginPanel clears the preset after inserting a plugin', () => {
    useLayoutStore.getState().applyPreset('classic');
    useLayoutStore.getState().addPluginPanel('plugin:disk-volumes');

    expect(useLayoutStore.getState().root).toEqual({
      direction: 'row',
      first: 'home',
      second: 'plugin:disk-volumes',
      splitPercentage: 70,
    });
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('addPluginPanel is idempotent when the plugin already exists', () => {
    useLayoutStore.getState().openPanel('plugin:disk-volumes');
    const before = useLayoutStore.getState().root;

    useLayoutStore.getState().addPluginPanel('plugin:disk-volumes');

    expect(useLayoutStore.getState().root).toBe(before);
  });

  it('opens up to the visible-panel limit and stacks the third under the active tile', () => {
    useLayoutStore.getState().setRoot('process');
    useLayoutStore.getState().openPanel('port', 'process');
    useLayoutStore.getState().openPanel('perf', 'port');

    expect(MAX_VISIBLE_PANELS).toBe(3);
    expect(useLayoutStore.getState().root).toEqual({
      direction: 'row',
      first: 'process',
      second: {
        direction: 'column',
        first: 'port',
        second: 'perf',
        splitPercentage: 50,
      },
      splitPercentage: 70,
    });
    expect(getPanelLeaves(useLayoutStore.getState().root)).toEqual(['process', 'port', 'perf']);
  });

  it('replaces the active leaf instead of creating a fourth panel', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    useLayoutStore.getState().openPanel('snapshot', 'port');

    expect(useLayoutStore.getState().root).toEqual({
      direction: 'row',
      first: 'process',
      splitPercentage: 70,
      second: {
        direction: 'column',
        first: 'snapshot',
        second: 'perf',
        splitPercentage: 50,
      },
    });
    expect(getPanelLeaves(useLayoutStore.getState().root)).toEqual(['process', 'snapshot', 'perf']);
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('replaces the last leaf when the active panel is unavailable', () => {
    const root = LAYOUT_PRESETS['dev-focus'];

    expect(openFocusedPanelRoot(root, 'sessions', 'snapshot')).toEqual({
      direction: 'row',
      first: 'process',
      splitPercentage: 70,
      second: {
        direction: 'column',
        first: 'port',
        second: 'sessions',
        splitPercentage: 50,
      },
    });
  });

  it('keeps an already-open panel idempotent at the visible-panel limit', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    const before = useLayoutStore.getState().root;

    useLayoutStore.getState().openPanel('perf', 'port');

    expect(useLayoutStore.getState().root).toBe(before);
    expect(useLayoutStore.getState().preset).toBe('dev-focus');
  });

  it('applies the same active-replacement policy to plugin panels', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    useLayoutStore.getState().addPluginPanel('plugin:disk-volumes', 'perf');

    expect(getPanelLeaves(useLayoutStore.getState().root)).toEqual([
      'process',
      'port',
      'plugin:disk-volumes',
    ]);
  });

  it('keeps only the requested current panel', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    useLayoutStore.getState().focusPanel('port');

    expect(useLayoutStore.getState().root).toBe('port');
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('limits a persisted custom tree to the first three DFS leaves', () => {
    const crowded: MosaicNode<PanelId> = {
      direction: 'row',
      first: {
        direction: 'column',
        first: 'process',
        second: 'port',
      },
      second: {
        direction: 'column',
        first: 'perf',
        second: 'snapshot',
      },
    };

    expect(limitVisiblePanels(crowded)).toEqual({
      direction: 'row',
      first: {
        direction: 'column',
        first: 'process',
        second: 'port',
      },
      second: 'perf',
    });
  });

  it('migrates a v1 crowded layout to the focused v2 schema', async () => {
    const crowded: MosaicNode<PanelId> = {
      direction: 'row',
      first: {
        direction: 'column',
        first: 'process',
        second: 'port',
      },
      second: {
        direction: 'column',
        first: 'perf',
        second: 'snapshot',
      },
    };
    localStorage.setItem('codemgr:layout', JSON.stringify({
      state: { root: crowded, preset: null },
      version: 1,
    }));

    await useLayoutStore.persist.rehydrate();

    expect(getPanelLeaves(useLayoutStore.getState().root)).toEqual(['process', 'port', 'perf']);
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('migrates a v0 custom tree with a stale preset to preset null', async () => {
    const legacyRoot: MosaicNode<PanelId> = {
      direction: 'row',
      first: 'port',
      second: 'process',
      splitPercentage: 45,
    };
    localStorage.setItem('codemgr:layout', JSON.stringify({
      state: { root: legacyRoot, preset: 'port-perf' },
      version: 0,
    }));

    await useLayoutStore.persist.rehydrate();

    expect(useLayoutStore.getState().root).toEqual(legacyRoot);
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('deduplicates repeated panel leaves while migrating a v0 layout', async () => {
    const legacyRoot: MosaicNode<PanelId> = {
      direction: 'row',
      first: {
        direction: 'column',
        first: 'plugin:disk-volumes',
        second: 'process',
        splitPercentage: 40,
      },
      second: {
        direction: 'column',
        first: 'plugin:disk-volumes',
        second: 'perf',
        splitPercentage: 60,
      },
      splitPercentage: 55,
    };
    localStorage.setItem('codemgr:layout', JSON.stringify({
      state: { root: legacyRoot, preset: 'dev-focus' },
      version: 0,
    }));

    await useLayoutStore.persist.rehydrate();

    expect(useLayoutStore.getState().root).toEqual({
      direction: 'row',
      first: {
        direction: 'column',
        first: 'plugin:disk-volumes',
        second: 'process',
        splitPercentage: 40,
      },
      second: 'perf',
      splitPercentage: 55,
    });
    expect(useLayoutStore.getState().preset).toBeNull();
  });

  it('migrates a nested v0 tree matching its preset without losing the preset', async () => {
    const legacyRoot: MosaicNode<PanelId> = {
      direction: 'row',
      first: 'process',
      splitPercentage: 70,
      second: {
        direction: 'column',
        first: 'port',
        second: 'perf',
        splitPercentage: 50,
      },
    };
    localStorage.setItem('codemgr:layout', JSON.stringify({
      state: { root: legacyRoot, preset: 'dev-focus' },
      version: 0,
    }));

    await useLayoutStore.persist.rehydrate();

    expect(useLayoutStore.getState().root).toEqual(legacyRoot);
    expect(useLayoutStore.getState().preset).toBe('dev-focus');
  });

  it('uses persist schema version 2', () => {
    expect(useLayoutStore.persist.getOptions().version).toBe(2);
  });

  it('persists only root + preset (partialize shape)', () => {
    localStorage.clear();
    useLayoutStore.getState().applyPreset('port-perf');
    // partialize must produce exactly { root, preset } — no setters.
    const api = (useLayoutStore as unknown as {
      persist: { getOptions: () => { partialize: (s: unknown) => unknown } };
    }).persist;
    const persisted = api.getOptions().partialize(useLayoutStore.getState());
    expect(persisted).toEqual({
      root: { direction: 'row', first: 'port', second: 'perf', splitPercentage: 50 },
      preset: 'port-perf',
    });
  });
});

describe('validatePersistedRoot（UX-12 同版本损坏校验）', () => {
  it('接受内置面板叶子与插件叶子', () => {
    expect(validatePersistedRoot('process')).toBe('process');
    expect(validatePersistedRoot('plugin:demo')).toBe('plugin:demo');
  });

  it('拒绝未知叶子 id 与非法类型', () => {
    expect(validatePersistedRoot('nope')).toBeNull();
    expect(validatePersistedRoot(123 as never)).toBeNull();
    expect(validatePersistedRoot({})).toBeNull();
  });

  it('拒绝结构残缺/方向非法的分支', () => {
    expect(validatePersistedRoot({ direction: 'row', first: 'port' } as never)).toBeNull();
    expect(validatePersistedRoot({ direction: 'sideways', first: 'port', second: 'perf' } as never)).toBeNull();
  });

  it('接受完整嵌套分支并保留 splitPercentage', () => {
    const v = validatePersistedRoot({
      direction: 'row', first: 'process', splitPercentage: 70,
      second: { direction: 'column', first: 'port', second: 'perf', splitPercentage: 50 },
    } as never);
    expect(v).toEqual({
      direction: 'row', first: 'process', splitPercentage: 70,
      second: { direction: 'column', first: 'port', second: 'perf', splitPercentage: 50 },
    });
  });

  it('null 保持 null（用户主动关掉所有面板是合法状态）', () => {
    expect(validatePersistedRoot(null)).toBeNull();
  });
});

describe('replacedPanelOf（UX-09 满员替换检测）', () => {
  const threeLeafRoot = {
    direction: 'row', first: 'process', splitPercentage: 70,
    second: { direction: 'column', first: 'port', second: 'perf', splitPercentage: 50 },
  };

  it('面板已存在 → null（幂等）', () => {
    expect(replacedPanelOf('process', 'process', null)).toBeNull();
  });

  it('叶子未达上限 → null（插入路径不替换）', () => {
    expect(replacedPanelOf('process', 'port', null)).toBeNull();
    expect(replacedPanelOf(
      { direction: 'row', first: 'process', second: 'port', splitPercentage: 70 },
      'perf', 'port',
    )).toBeNull();
  });

  it('达到上限时替换活跃叶', () => {
    expect(replacedPanelOf(threeLeafRoot, 'snapshot', 'port')).toBe('port');
  });

  it('活跃叶失效（不在树中）时回退最后一个叶子', () => {
    expect(replacedPanelOf(threeLeafRoot, 'snapshot', null)).toBe('perf');
    expect(replacedPanelOf(threeLeafRoot, 'snapshot', 'nope' as never)).toBe('perf');
  });
});
