import { describe, it, expect, beforeEach } from 'vitest';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

const sampleProc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1234, ppid: 0, name: 'node.exe', cmdline: 'node index.js', cwd: '',
  kernelTimeMs: 100, userTimeMs: 200, workingSetBytes: 100 * 1024 * 1024,
  createTimeMs: Date.now(), threadCount: 8, handleCount: 100,
  ...over,
});

describe('processPanelStore', () => {
  // persist middleware reads/writes localStorage; clear it before each test so
  // rehydrated state from a prior test can't leak in (reset() alone re-persists).
  beforeEach(() => {
    localStorage.clear();
    useProcessPanelStore.getState().reset();
  });

  it('starts empty', () => {
    const s = useProcessPanelStore.getState();
    expect(s.processes).toEqual([]);
    expect(s.cpuMap).toEqual({});
    expect(s.filter).toBe('');
    expect(s.sortKey).toBe('pid');
    expect(s.expandedPids.size).toBe(0);
  });

  it('setProcesses populates list', () => {
    useProcessPanelStore.getState().setProcesses([sampleProc({ pid: 1 }), sampleProc({ pid: 2 })]);
    expect(useProcessPanelStore.getState().processes.length).toBe(2);
  });

  it('setCpuMap merges CPU data', () => {
    useProcessPanelStore.getState().setCpuMap([{ pid: 1, cpuPercent: 12.5 }]);
    expect(useProcessPanelStore.getState().cpuMap[1]).toBe(12.5);
  });

  it('setFilter filters by name/cmdline/pid', () => {
    useProcessPanelStore.getState().setFilter('node');
    expect(useProcessPanelStore.getState().filter).toBe('node');
  });

  it('setSortKey changes sort field', () => {
    useProcessPanelStore.getState().setSortKey('cpu');
    expect(useProcessPanelStore.getState().sortKey).toBe('cpu');
  });

  it('toggleExpand toggles tree node', () => {
    useProcessPanelStore.getState().toggleExpand(42);
    expect(useProcessPanelStore.getState().expandedPids.has(42)).toBe(true);
    useProcessPanelStore.getState().toggleExpand(42);
    expect(useProcessPanelStore.getState().expandedPids.has(42)).toBe(false);
  });

  it('toggleSelect toggles selection', () => {
    useProcessPanelStore.getState().toggleSelect(7);
    expect(useProcessPanelStore.getState().selectedPids.has(7)).toBe(true);
    useProcessPanelStore.getState().toggleSelect(7);
    expect(useProcessPanelStore.getState().selectedPids.has(7)).toBe(false);
  });

  it('selectAll() with no args selects all processes', () => {
    useProcessPanelStore.getState().setProcesses([sampleProc({ pid: 1 }), sampleProc({ pid: 2 }), sampleProc({ pid: 3 })]);
    useProcessPanelStore.getState().selectAll();
    const s = useProcessPanelStore.getState();
    expect(s.selectedPids.has(1)).toBe(true);
    expect(s.selectedPids.has(2)).toBe(true);
    expect(s.selectedPids.has(3)).toBe(true);
  });

  it('selectAll(pids) only selects given pids (respects filter)', () => {
    useProcessPanelStore.getState().setProcesses([sampleProc({ pid: 1 }), sampleProc({ pid: 2 }), sampleProc({ pid: 3 })]);
    useProcessPanelStore.getState().selectAll([1, 2]);
    const s = useProcessPanelStore.getState();
    expect(s.selectedPids.has(1)).toBe(true);
    expect(s.selectedPids.has(2)).toBe(true);
    expect(s.selectedPids.has(3)).toBe(false);
  });

  it('clearSelection empties selectedPids', () => {
    useProcessPanelStore.getState().toggleSelect(1);
    useProcessPanelStore.getState().clearSelection();
    expect(useProcessPanelStore.getState().selectedPids.size).toBe(0);
  });

  it('setProcesses prunes stale selectedPids', () => {
    const st = useProcessPanelStore.getState();
    st.setProcesses([sampleProc({ pid: 1 })]);
    st.toggleSelect(1);
    st.toggleSelect(99); // not in list
    st.setProcesses([sampleProc({ pid: 1 })]); // 99 gone
    expect(useProcessPanelStore.getState().selectedPids.has(99)).toBe(false);
    expect(useProcessPanelStore.getState().selectedPids.has(1)).toBe(true);
  });

  it('setProcesses prunes stale cpuMap entries', () => {
    const st = useProcessPanelStore.getState();
    st.setCpuMap([{ pid: 1, cpuPercent: 10 }, { pid: 99, cpuPercent: 50 }]);
    st.setProcesses([sampleProc({ pid: 1 })]); // 99 gone
    const m = useProcessPanelStore.getState().cpuMap;
    expect(m[1]).toBe(10);
    expect(m[99]).toBeUndefined();
  });

  it('appendHistory records a point pairing cpu + mem from same tick', () => {
    const st = useProcessPanelStore.getState();
    const procs = [sampleProc({ pid: 1, workingSetBytes: 200 })];
    st.appendHistory(procs, [{ pid: 1, cpuPercent: 42 }], 1000);
    const hist = useProcessPanelStore.getState().procHistory[1];
    expect(hist).toHaveLength(1);
    expect(hist[0]).toEqual({ ts: 1000, cpu: 42, mem: 200 });
  });

  it('appendHistory rolls the window at PROC_HIST_LEN', () => {
    const st = useProcessPanelStore.getState();
    const procs = [sampleProc({ pid: 1, workingSetBytes: 0 })];
    for (let i = 0; i < 70; i++) st.appendHistory(procs, [{ pid: 1, cpuPercent: i }], i);
    const hist = useProcessPanelStore.getState().procHistory[1];
    expect(hist).toHaveLength(60); // capped
    expect(hist[0].cpu).toBe(10);  // oldest kept (70-60=10)
    expect(hist[59].cpu).toBe(69); // newest
  });

  it('setProcesses prunes stale procHistory entries', () => {
    const st = useProcessPanelStore.getState();
    st.appendHistory([sampleProc({ pid: 1 })], [{ pid: 1, cpuPercent: 5 }], 1);
    st.appendHistory([sampleProc({ pid: 99 })], [{ pid: 99, cpuPercent: 9 }], 2);
    st.setProcesses([sampleProc({ pid: 1 })]); // 99 gone
    const h = useProcessPanelStore.getState().procHistory;
    expect(h[1]).toBeDefined();
    expect(h[99]).toBeUndefined();
  });

  it('persists only sortKey/sortAsc/filter/viewMode (partialize shape)', () => {
    localStorage.clear();
    const st = useProcessPanelStore.getState();
    st.setSortKey('cpu');
    st.toggleSort(); // sortAsc -> false
    st.setFilter('node');
    st.setViewMode('project');
    // partialize must produce exactly { sortKey, sortAsc, filter, viewMode, sidebarProportion, pollMs } —
    // no processes/cpuMap/selectedPids/etc. The store exposes its persist API.
    const api = (useProcessPanelStore as unknown as {
      persist: { getOptions: () => { partialize: (s: unknown) => unknown } };
    }).persist;
    const opts = api.getOptions();
    const persisted = opts.partialize(useProcessPanelStore.getState());
    expect(persisted).toEqual({
      sortKey: 'cpu', sortAsc: false, filter: 'node', viewMode: 'project',
      sidebarProportion: 0.3, pollMs: 2000,
    });
  });

  it('pollMs defaults to 2000 (process panel interval)', () => {
    expect(useProcessPanelStore.getState().pollMs).toBe(2000);
  });

  it('setPollMs updates the refresh interval (0 = paused)', () => {
    const st = useProcessPanelStore.getState();
    st.setPollMs(5000);
    expect(useProcessPanelStore.getState().pollMs).toBe(5000);
    st.setPollMs(0);
    expect(useProcessPanelStore.getState().pollMs).toBe(0);
  });

  it('setSidebarProportion clamps to 0.15-0.6', () => {
    const st = useProcessPanelStore.getState();
    st.setSidebarProportion(0.5);
    expect(useProcessPanelStore.getState().sidebarProportion).toBe(0.5);
    // 过小 → 钳到 0.15
    st.setSidebarProportion(0.01);
    expect(useProcessPanelStore.getState().sidebarProportion).toBe(0.15);
    // 过大 → 钳到 0.6
    st.setSidebarProportion(0.99);
    expect(useProcessPanelStore.getState().sidebarProportion).toBe(0.6);
    // 边界值原样保留
    st.setSidebarProportion(0.15);
    expect(useProcessPanelStore.getState().sidebarProportion).toBe(0.15);
    st.setSidebarProportion(0.6);
    expect(useProcessPanelStore.getState().sidebarProportion).toBe(0.6);
  });

  it('toggleViewMode switches tree <-> project', () => {
    expect(useProcessPanelStore.getState().viewMode).toBe('tree');
    useProcessPanelStore.getState().toggleViewMode();
    expect(useProcessPanelStore.getState().viewMode).toBe('project');
    useProcessPanelStore.getState().toggleViewMode();
    expect(useProcessPanelStore.getState().viewMode).toBe('tree');
  });

  it('toggleGroup toggles a project group expand', () => {
    expect(useProcessPanelStore.getState().expandedGroups.has('app')).toBe(false);
    useProcessPanelStore.getState().toggleGroup('app');
    expect(useProcessPanelStore.getState().expandedGroups.has('app')).toBe(true);
    useProcessPanelStore.getState().toggleGroup('app');
    expect(useProcessPanelStore.getState().expandedGroups.has('app')).toBe(false);
  });
});

