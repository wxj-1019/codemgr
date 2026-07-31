import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

// 桩 usePerfStore：ProcessTable 读 perfStore 的 GPU 数据，测试里置空避免无关渲染
vi.mock('../src/store/perfStore', () => ({
  usePerfStore: (sel: any) => sel({ current: null }),
}));

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'node.exe', cmdline: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, cwd: '',
  ...over,
});

function rowPids(): number[] {
  // 取所有数据行（跳过表头）的 PID 单元格文本，按出现顺序。
  // 默认模式不渲染选择列，因此 PID 是第 5 个单元格（索引 4）。
  return screen.getAllByRole('row').slice(1).map((r) =>
    Number(r.querySelectorAll('td')[4]?.textContent?.trim() ?? '-1'),
  );
}

describe('ProcessTable sort', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree', expandedPids: new Set() });
  });

  it('sorts flat list by CPU descending when CPU header clicked twice', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, name: 'a.exe' }),
        p({ pid: 2, name: 'b.exe' }),
        p({ pid: 3, name: 'c.exe' }),
      ],
      cpuMap: { 1: 10, 2: 50, 3: 30 },
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // 点 CPU 表头第一次：切到 cpu 列（默认升序）→ cpu 10,30,50 → pid 1,3,2
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([1, 3, 2]);
    // 点第二次：翻转降序 → cpu 50,30,10 → pid 2,3,1
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([2, 3, 1]);
  });

  it('preserves sort order into tree DFS when expanded', () => {
    // pid 1 是 root，pid 2/3 是其子进程（ppid=1）。CPU 降序期望 root 先出现
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0, name: 'root.exe' }),
        p({ pid: 2, ppid: 1, name: 'childA.exe' }),
        p({ pid: 3, ppid: 1, name: 'childB.exe' }),
      ],
      cpuMap: { 1: 50, 2: 10, 3: 30 },
      expandedPids: new Set([1]), // 展开 root
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // CPU 列降序：root(50) 最先，其后子进程按 cpu 降序 30,10
    fireEvent.click(screen.getByText(/CPU%/));
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([1, 3, 2]);
  });

  it('defaults to PID ascending (zero regression)', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 30, name: 'c.exe' }),
        p({ pid: 10, name: 'a.exe' }),
        p({ pid: 20, name: 'b.exe' }),
      ],
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // 默认 sortKey=pid, sortAsc=true → 10,20,30
    expect(rowPids()).toEqual([10, 20, 30]);
  });
});

describe('ProcessTable CPU 排序冻结（UX-14）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree', expandedPids: new Set(), sortKey: 'pid', sortAsc: true });
  });

  it('按 CPU 排序后数值更新不改变行序（点击目标不漂移）', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, name: 'a.exe' }),
        p({ pid: 2, name: 'b.exe' }),
        p({ pid: 3, name: 'c.exe' }),
      ],
      cpuMap: { 1: 10, 2: 50, 3: 30 },
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    // 第一次点 CPU 表头：切到 cpu 升序 → pid 1,3,2
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([1, 3, 2]);

    // 轮询更新 cpuMap：若实时重排会变成 pid 3,1,2——冻结后行序不变
    act(() => {
      useProcessPanelStore.setState({ cpuMap: { 1: 90, 2: 5, 3: 40 } });
    });
    expect(rowPids()).toEqual([1, 3, 2]);
  });

  it('再次点击同列（翻转方向）后按新方向重排', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, name: 'a.exe' }),
        p({ pid: 2, name: 'b.exe' }),
        p({ pid: 3, name: 'c.exe' }),
      ],
      cpuMap: { 1: 10, 2: 50, 3: 30 },
    });
    render(<ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(screen.getByText(/CPU%/));
    expect(rowPids()).toEqual([1, 3, 2]);

    fireEvent.click(screen.getByText(/CPU%/)); // 翻转降序
    expect(rowPids()).toEqual([2, 3, 1]);
  });
});
