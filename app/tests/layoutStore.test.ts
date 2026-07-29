import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, type PanelId } from '../src/store/layoutStore';
import type { MosaicNode } from 'react-mosaic-component';

describe('layoutStore', () => {
  // persist middleware reads/writes localStorage; clear it before each test so
  // rehydrated state from a prior test can't leak in (reset() alone re-persists).
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.getState().reset();
  });

  it('defaults to the classic preset (process fills the screen)', () => {
    const s = useLayoutStore.getState();
    expect(s.root).toBe('process');
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

  it('applyPreset("classic") restores single process panel', () => {
    useLayoutStore.getState().applyPreset('dev-focus');
    useLayoutStore.getState().applyPreset('classic');
    expect(useLayoutStore.getState().root).toBe('process');
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
