import { describe, it, expect, beforeEach } from 'vitest';
import { firstPanelLeaf, useActivePanelStore } from '../src/store/activePanelStore';

describe('activePanelStore', () => {
  beforeEach(() => {
    useActivePanelStore.getState().reset();
  });

  it('starts with no active panel', () => {
    expect(useActivePanelStore.getState().activeId).toBeNull();
  });

  it('setActive records the panel id', () => {
    useActivePanelStore.getState().setActive('process');
    expect(useActivePanelStore.getState().activeId).toBe('process');
  });

  it('setActive replaces the previous active panel (only one glows)', () => {
    useActivePanelStore.getState().setActive('process');
    useActivePanelStore.getState().setActive('port');
    expect(useActivePanelStore.getState().activeId).toBe('port');
  });

  it('reset clears the active panel', () => {
    useActivePanelStore.getState().setActive('perf');
    useActivePanelStore.getState().reset();
    expect(useActivePanelStore.getState().activeId).toBeNull();
  });

  it('finds the first leaf in Mosaic traversal order', () => {
    expect(firstPanelLeaf({
      direction: 'row',
      first: {
        direction: 'column',
        first: 'sessions',
        second: 'perf',
      },
      second: 'process',
    })).toBe('sessions');
    expect(firstPanelLeaf(null)).toBeNull();
  });

  it('keeps the active panel when it still exists after a root change', () => {
    useActivePanelStore.getState().setActive('perf');

    useActivePanelStore.getState().reconcile({
      direction: 'row',
      first: 'process',
      second: 'perf',
    });

    expect(useActivePanelStore.getState().activeId).toBe('perf');
  });

  it('falls back to the first leaf when the active panel is removed', () => {
    useActivePanelStore.getState().setActive('snapshot');

    useActivePanelStore.getState().reconcile({
      direction: 'row',
      first: 'process',
      second: 'perf',
    });

    expect(useActivePanelStore.getState().activeId).toBe('process');
  });

  it('clears the active panel when the root becomes empty', () => {
    useActivePanelStore.getState().setActive('perf');

    useActivePanelStore.getState().reconcile(null);

    expect(useActivePanelStore.getState().activeId).toBeNull();
  });
});
