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
});
