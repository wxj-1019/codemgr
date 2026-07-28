import { describe, it, expect, beforeEach } from 'vitest';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

const sampleProc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1234, ppid: 0, name: 'node.exe', cmdline: 'node index.js',
  kernelTimeMs: 100, userTimeMs: 200, workingSetBytes: 100 * 1024 * 1024,
  createTimeMs: Date.now(), threadCount: 8, handleCount: 100,
  ...over,
});

describe('processPanelStore', () => {
  beforeEach(() => useProcessPanelStore.getState().reset());

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
});

