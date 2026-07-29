import { describe, it, expect, beforeEach } from 'vitest';
import { useActivePanelStore } from '../src/store/activePanelStore';

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
});
