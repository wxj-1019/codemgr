import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useFocusStore } from '../src/store/focusStore';
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
    useFocusStore.getState().focus(null);
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree' });
  });

  it('hides selection controls by default and row click only focuses', () => {
    useProcessPanelStore.setState({
      processes: [p({ pid: 41, name: 'vite.exe' })],
      selectedPids: new Set([41]),
    });

    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const row = container.querySelector('tbody tr[role="row"]')!;
    expect(row).not.toHaveAttribute('aria-selected');
    fireEvent.click(row);
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 41, sourcePanel: 'process' });
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([41]));
  });

  it('does not expose stale selection styling while multi-select mode is disabled', () => {
    useProcessPanelStore.setState({
      processes: [p({ pid: 41, name: 'vite.exe' })],
      selectedPids: new Set([41]),
    });

    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );

    const row = container.querySelector('tbody tr[role="row"]')!;
    expect(row).not.toHaveClass('bg-base-700/50');
  });

  it('shows selection controls in multi-select mode and row click selects and focuses', () => {
    useProcessPanelStore.setState({ processes: [p({ pid: 42, name: 'vite.exe' })] });
    const { container } = render(
      <ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    const row = container.querySelector('tbody tr[role="row"]')!;
    expect(row).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(row);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([42]));
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 42, sourcePanel: 'process' });
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('row checkbox toggles selection without changing focus', () => {
    useProcessPanelStore.setState({ processes: [p({ pid: 43 })] });
    useFocusStore.getState().focus(99, 'port');
    render(
      <ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([43]));
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 99, sourcePanel: 'port' });
  });

  it('kill action does not activate the process row', () => {
    useProcessPanelStore.setState({ processes: [p({ pid: 45 })] });
    const onKillSingle = vi.fn();
    const { container } = render(
      <ProcessTable multiSelectEnabled onKillSingle={onKillSingle} onKillTree={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '结束' }));

    expect(onKillSingle).toHaveBeenCalledWith(45, 'node.exe');
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(useFocusStore.getState().focusedPid).toBeNull();
    expect(container.querySelector('tbody tr[role="row"]')).toHaveAttribute('aria-selected', 'false');
  });

  it('checkbox keyboard interaction only changes selection and does not focus the row', () => {
    useProcessPanelStore.setState({ processes: [p({ pid: 44 })] });
    useFocusStore.getState().focus(99, 'port');
    render(
      <ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />,
    );

    fireEvent.keyDown(screen.getAllByRole('checkbox')[1], { key: ' ' });
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 99, sourcePanel: 'port' });
  });

  it('falls back to the first visible row when the focused row is filtered out', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, name: 'alpha.exe' }),
        p({ pid: 2, name: 'beta.exe' }),
        p({ pid: 3, name: 'gamma.exe' }),
      ],
    });
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    const rows = () => Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr[role="row"]'));

    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: 'ArrowDown' });
    expect(rows()[1]).toHaveFocus();
    act(() => useProcessPanelStore.setState({ filter: 'gamma' }));

    expect(rows()).toHaveLength(1);
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(rows()[0]).toHaveAttribute('tabindex', '0');
    expect(rows()[0]).toHaveFocus();
  });

  it('uses a dynamic empty-state colSpan', () => {
    const { container, rerender } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    expect(container.querySelector('tbody td')).toHaveAttribute('colspan', '8');

    rerender(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
    expect(container.querySelector('tbody td')).toHaveAttribute('colspan', '9');
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
    render(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
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
    render(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1, 2, 3]));
  });

  it('select-all after filtering adds matching visible rows without clearing hidden selection', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0, name: 'vite.exe' }),
        p({ pid: 2, ppid: 0, name: 'node.exe' }),
        p({ pid: 3, ppid: 0, name: 'node.exe' }),
      ],
      filter: 'node', // 只匹配 pid 2/3
      selectedPids: new Set([1]),
    });
    render(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1, 2, 3]));
  });

  it('clearing all visible rows preserves selected hidden rows', () => {
    useProcessPanelStore.setState({
      processes: [
        p({ pid: 1, ppid: 0, name: 'vite.exe' }),
        p({ pid: 2, ppid: 0, name: 'node.exe' }),
        p({ pid: 3, ppid: 0, name: 'node.exe' }),
      ],
      filter: 'node',
      selectedPids: new Set([1, 2, 3]),
    });
    render(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
    fireEvent.click(selectAllCheckbox());
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([1]));
  });
});

describe('ProcessTable 表头半选态（UX-21）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useFocusStore.getState().focus(null);
    useProcessPanelStore.setState({ filter: '', viewMode: 'tree', sortKey: 'pid', sortAsc: true });
  });

  it('部分选中时全选框呈 indeterminate（不再空框误导）', () => {
    useProcessPanelStore.setState({
      processes: [p({ pid: 1, name: 'a.exe' }), p({ pid: 2, name: 'b.exe' })],
      selectedPids: new Set([1]),
    });
    render(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
    const cb = selectAllCheckbox();
    expect(cb.checked).toBe(false);
    expect(cb.indeterminate).toBe(true);
  });

  it('全选后恢复 determinate 且 checked', () => {
    useProcessPanelStore.setState({
      processes: [p({ pid: 1, name: 'a.exe' }), p({ pid: 2, name: 'b.exe' })],
      selectedPids: new Set([1, 2]),
    });
    render(<ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />);
    const cb = selectAllCheckbox();
    expect(cb.checked).toBe(true);
    expect(cb.indeterminate).toBe(false);
  });
});
