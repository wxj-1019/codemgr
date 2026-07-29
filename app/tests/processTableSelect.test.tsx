import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

vi.mock('../src/store/perfStore', () => ({
  usePerfStore: (sel: any) => sel({ current: null }),
}));

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'node.exe', cmdline: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, cwd: '',
  ...over,
});

// 取表头全选 checkbox（aria-label="全选可见行" 或 "全选当前列表"，兼容过渡）
function selectAllCheckbox(): HTMLInputElement {
  return screen.getByLabelText(/全选/) as HTMLInputElement;
}

describe('ProcessTable select-all visibility', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree' });
  });

  it('select-all with collapsed children selects only visible (root) rows', () => {
    // root pid 1，子进程 pid 2/3 折叠（expandedPids 不含 1）
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0 }),
        p({ pid: 2, ppid: 1 }),
        p({ pid: 3, ppid: 1 }),
      ],
      expandedPids: new Set(), // 折叠：子进程不可见
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    // 只有可见的 root(pid 1) 被选；折叠的 2/3 不选
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1]));
  });

  it('select-all with expanded children selects root + children', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0 }),
        p({ pid: 2, ppid: 1 }),
        p({ pid: 3, ppid: 1 }),
      ],
      expandedPids: new Set([1]), // 展开：子进程可见
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1, 2, 3]));
  });

  it('select-all after filtering selects only matching visible rows', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0, name: 'vite.exe' }),
        p({ pid: 2, ppid: 0, name: 'node.exe' }),
        p({ pid: 3, ppid: 0, name: 'node.exe' }),
      ],
      filter: 'node', // 只匹配 pid 2/3
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([2, 3]));
  });
});
