import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ProcessInfo } from '../electron/ipc-types';
import { ProjectGroupView } from '../src/components/ProjectGroupView';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useFocusStore } from '../src/store/focusStore';

vi.mock('../src/lib/ipc', () => ({
  ipc: { fetchCwd: vi.fn(() => Promise.resolve(null)) },
}));

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 10,
  ppid: 0,
  name: 'vite.exe',
  cmdline: 'vite app.js',
  cwd: 'C:\\work\\app',
  kernelTimeMs: 0,
  userTimeMs: 0,
  workingSetBytes: 100,
  createTimeMs: 0,
  threadCount: 1,
  handleCount: 1,
  ...over,
});

function seed() {
  useProcessPanelStore.setState({
    processes: [proc({ pid: 10 }), proc({ pid: 20, name: 'node.exe', cmdline: 'node server.js' })],
    selectedPids: new Set(),
    expandedGroups: new Set(['C:/work/app']),
    filter: '',
  });
}

const props = {
  onKillSingle: vi.fn(),
  onKillGroup: vi.fn(),
  onKillTree: vi.fn(),
};

describe('ProjectGroupView multi-select mode', () => {
  beforeEach(() => {
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useFocusStore.getState().focus(null);
    vi.clearAllMocks();
    seed();
  });

  it('default child row click focuses without rendering checkboxes or selecting', () => {
    const { container } = render(<ProjectGroupView {...props} />);
    const child = container.querySelector('tbody tr:nth-child(2)')!;

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(child);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 10, sourcePanel: 'process' });
  });

  it('does not expose stale child selection styling while multi-select mode is disabled', () => {
    useProcessPanelStore.setState({ selectedPids: new Set([10]) });
    const { container } = render(<ProjectGroupView {...props} />);
    const child = container.querySelector('tbody tr:nth-child(2)')!;

    expect(child).not.toHaveAttribute('aria-selected');
    expect(child).not.toHaveClass('bg-base-700/50');
  });

  it('multi-select child row click selects and focuses while checkbox only selects', () => {
    const { container } = render(<ProjectGroupView multiSelectEnabled {...props} />);
    const child = container.querySelector('tbody tr:nth-child(2)')!;

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(child);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([10]));
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 10, sourcePanel: 'process' });

    act(() => useFocusStore.getState().focus(99, 'port'));
    fireEvent.click(screen.getByLabelText('选择 vite.exe（PID 10）'));
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 99, sourcePanel: 'port' });
  });

  it('child kill action does not activate the process row', () => {
    const { container } = render(<ProjectGroupView multiSelectEnabled {...props} />);
    const child = container.querySelector('tbody tr:nth-child(2)')!;
    fireEvent.click(screen.getAllByRole('button', { name: '结束' })[0]);

    expect(props.onKillSingle).toHaveBeenCalledWith(10, 'vite.exe');
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(useFocusStore.getState().focusedPid).toBeNull();
    expect(child).toHaveAttribute('aria-selected', 'false');
  });

  it('child checkbox keyboard interaction does not focus the row', () => {
    render(<ProjectGroupView multiSelectEnabled {...props} />);
    act(() => useFocusStore.getState().focus(99, 'port'));
    fireEvent.keyDown(screen.getByLabelText('选择 vite.exe（PID 10）'), { key: ' ' });
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 99, sourcePanel: 'port' });
  });

  it('child row Enter and Space follow the same mode selection contract', () => {
    const { container } = render(<ProjectGroupView multiSelectEnabled {...props} />);
    const child = container.querySelector('tbody tr:nth-child(2)')!;

    fireEvent.keyDown(child, { key: 'Enter' });
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([10]));
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 10, sourcePanel: 'process' });
    fireEvent.keyDown(child, { key: ' ' });
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
  });

  it('selects only expanded child rows from the project view header', () => {
    useProcessPanelStore.setState({ expandedGroups: new Set() });
    render(<ProjectGroupView multiSelectEnabled {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选可见行' }));
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
  });

  it('header select and clear preserve selected hidden project rows', () => {
    useProcessPanelStore.setState({
      processes: [
        proc({ pid: 10 }),
        proc({ pid: 20, name: 'node.exe', cmdline: 'node server.js' }),
        proc({ pid: 30, name: 'python.exe', cwd: 'C:\\work\\hidden' }),
      ],
      selectedPids: new Set([30]),
    });
    render(<ProjectGroupView multiSelectEnabled {...props} />);
    const headerCheckbox = screen.getByRole('checkbox', { name: '全选可见行' });

    fireEvent.click(headerCheckbox);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([10, 20, 30]));
    fireEvent.click(headerCheckbox);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([30]));
  });

  it('aligns nine multi-select headers with nine child-row cells', () => {
    const { container } = render(<ProjectGroupView multiSelectEnabled {...props} />);
    const header = container.querySelector('thead tr')!;
    const child = container.querySelector('tbody tr:nth-child(2)')!;

    expect(header.children).toHaveLength(9);
    expect(child.children).toHaveLength(9);
  });

  it('shows the local ring indicator when a child row receives keyboard focus', () => {
    const { container } = render(<ProjectGroupView {...props} />);
    const child = container.querySelector<HTMLTableRowElement>('tbody tr[role="row"]')!;

    child.focus();
    expect(child).toHaveFocus();
    expect(child).toHaveClass(
      'focus-visible:ring-1',
      'focus-visible:ring-inset',
      'focus-visible:ring-accent/60',
      'focus-visible:outline-none',
    );
  });

  it('marks only the globally focused child with the persistent cyan ring', () => {
    useFocusStore.getState().focus(20, 'port');
    const { container } = render(<ProjectGroupView {...props} />);
    const children = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr[role="row"]'));

    expect(children[1]).toHaveAttribute('data-pid', '20');
    expect(children[1]).toHaveClass('ring-2', 'ring-inset', 'ring-cyan-400/70');
    expect(children[0]).not.toHaveClass('ring-2', 'ring-cyan-400/70');
  });

  it('uses roving tabindex and moves child-row focus with ArrowDown', () => {
    const { container } = render(<ProjectGroupView multiSelectEnabled {...props} />);
    const children = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr[role="row"]'));

    expect(children.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(children[0]).toHaveAttribute('tabindex', '0');
    expect(children[1]).toHaveAttribute('tabindex', '-1');

    children[0].focus();
    fireEvent.keyDown(children[0], { key: 'ArrowDown' });
    expect(children[1]).toHaveFocus();
    expect(children[0]).toHaveAttribute('tabindex', '-1');
    expect(children[1]).toHaveAttribute('tabindex', '0');
  });

  it('falls back to the first visible child when the focused group collapses', () => {
    useProcessPanelStore.setState({
      processes: [
        proc({ pid: 10, cwd: 'C:\\work\\alpha' }),
        proc({ pid: 30, name: 'python.exe', cwd: 'C:\\work\\beta' }),
      ],
      expandedGroups: new Set(['C:/work/alpha', 'C:/work/beta']),
    });
    const { container } = render(<ProjectGroupView {...props} />);
    const children = () => Array.from(
      container.querySelectorAll<HTMLTableRowElement>('tbody tr[role="row"]'),
    );

    children()[0].focus();
    fireEvent.keyDown(children()[0], { key: 'ArrowDown' });
    expect(children()[1]).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /beta/ }));

    expect(children()).toHaveLength(1);
    expect(children().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(children()[0]).toHaveAttribute('tabindex', '0');
    expect(children()[0]).toHaveFocus();
  });

  it('group header expands without changing selection and group kill stays independent', () => {
    useProcessPanelStore.setState({ expandedGroups: new Set() });
    const { container } = render(<ProjectGroupView multiSelectEnabled {...props} />);
    const groupButton = screen.getByRole('button', { name: /app/ });

    fireEvent.click(groupButton);
    expect(useProcessPanelStore.getState().expandedGroups).toEqual(new Set(['C:/work/app']));
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(props.onKillGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '结束本组' }));
    expect(props.onKillGroup).toHaveBeenCalledWith('app', [10, 20]);
    expect(container.querySelector('tbody tr:nth-child(2)')).not.toBeNull();
  });
});

describe('ProjectGroupView 表头半选态（UX-21）', () => {
  it('部分选中时全选框呈 indeterminate', () => {
    useProcessPanelStore.setState({
      processes: [proc({ pid: 10 }), proc({ pid: 20, name: 'node.exe', cmdline: 'node server.js' })],
      selectedPids: new Set([10]),
      expandedGroups: new Set(['C:/work/app']),
      filter: '',
    });
    render(<ProjectGroupView {...props} multiSelectEnabled />);
    const cb = screen.getByLabelText(/全选/) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(cb.indeterminate).toBe(true);
  });
});
