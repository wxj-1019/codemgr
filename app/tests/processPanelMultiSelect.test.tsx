import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ProcessInfo } from '../electron/ipc-types';
import { ProcessPanel } from '../src/components/ProcessPanel';
import { ToastHost } from '../src/components/ToastHost';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { ipc } from '../src/lib/ipc';

vi.mock('../src/hooks/useProcessPanel', () => ({ useProcessPanel: vi.fn() }));
vi.mock('../src/hooks/useContainerWidth', () => ({ useContainerWidth: () => 800 }));
vi.mock('../src/lib/ipc', () => ({
  ipc: {
    killByPids: vi.fn(() => Promise.resolve([{ pid: 10, status: 'killed' }])),
    killProcess: vi.fn(() => Promise.resolve('killed')),
    killByName: vi.fn(() => Promise.resolve(1)),
    killTree: vi.fn(() => Promise.resolve(1)),
  },
}));
vi.mock('../src/components/ProcessTable', () => ({
  ProcessTable: ({ multiSelectEnabled, onKillSingle }: { multiSelectEnabled?: boolean; onKillSingle?: (pid: number, name: string) => void }) => (
    <div data-testid="process-table" data-multi-select={String(!!multiSelectEnabled)}>
      <button onClick={() => onKillSingle?.(10, 'vite.exe')}>kill-single</button>
    </div>
  ),
}));
vi.mock('../src/components/ProjectGroupView', () => ({
  ProjectGroupView: ({ multiSelectEnabled }: { multiSelectEnabled?: boolean }) => (
    <div data-testid="project-view" data-multi-select={String(!!multiSelectEnabled)} />
  ),
}));
vi.mock('../src/components/ProcessDetailSidebar', () => ({
  ProcessDetailSidebar: () => <div data-testid="process-sidebar" />,
}));
vi.mock('allotment', () => {
  const Allotment = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Allotment.Pane = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { Allotment };
});

const proc = (pid: number, name: string): ProcessInfo => ({
  pid,
  ppid: 0,
  name,
  cmdline: `${name} app.js`,
  cwd: '',
  kernelTimeMs: 0,
  userTimeMs: 0,
  workingSetBytes: 0,
  createTimeMs: 0,
  threadCount: 1,
  handleCount: 1,
});

function seed(selectedPids = new Set<number>()) {
  useProcessPanelStore.setState({
    processes: [proc(10, 'vite.exe'), proc(20, 'python.exe')],
    selectedPids,
    loading: false,
    error: null,
    viewMode: 'tree',
  });
}

describe('ProcessPanel multi-select mode', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', vi.fn((callback: ResizeObserverCallback) => ({
      observe: () => callback(
        [{ contentRect: { width: 800 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.mocked(ipc.killByPids).mockResolvedValue([{ pid: 10, status: 'killed' }]);
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    seed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides stale selection from the default-mode summary', () => {
    seed(new Set([10]));
    render(<><ToastHost /><ProcessPanel /></>);

    expect(screen.queryByText(/已选 1 个/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /批量结束/ })).not.toBeInTheDocument();
  });

  it('toggles mode, clears selection on both transitions, and wires both views', () => {
    seed(new Set([10]));
    render(<><ToastHost /><ProcessPanel /></>);

    const modeButton = screen.getByRole('button', { name: '多选' });
    expect(modeButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /批量结束/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('process-table')).toHaveAttribute('data-multi-select', 'false');

    fireEvent.click(modeButton);
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(screen.getByRole('button', { name: '完成' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('process-table')).toHaveAttribute('data-multi-select', 'true');

    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([20]) });
    });
    expect(screen.getByRole('button', { name: '批量结束 (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '按项目' }));
    expect(screen.getByTestId('project-view')).toHaveAttribute('data-multi-select', 'true');

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    expect(screen.getByRole('button', { name: '多选' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes pending batch confirmation when mode is completed', () => {
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (1)' }));
    expect(screen.getByRole('dialog', { name: '批量结束进程' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.queryByRole('dialog', { name: '批量结束进程' })).not.toBeInTheDocument();
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
  });

  it('clears selection after successful batch kill and keeps mode enabled', async () => {
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (1)' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量结束' }));
    });

    await vi.waitFor(() => {
      expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
    });
    expect(ipc.killByPids).toHaveBeenCalledWith([10]);
    expect(screen.getByRole('button', { name: '完成' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves selection when batch kill ends zero processes', async () => {
    vi.mocked(ipc.killByPids).mockResolvedValueOnce([{ pid: 10, status: 'protected' }]);
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (1)' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量结束' }));
    });

    await vi.waitFor(() => {
      expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([10]));
    });
    expect(screen.getByRole('button', { name: '完成' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('批量结束失败原因逐项展示（UX-04：受保护/权限不足/已退出分开说）', async () => {
    vi.mocked(ipc.killByPids).mockResolvedValueOnce([
      { pid: 10, status: 'killed' },
      { pid: 20, status: 'protected' },
      { pid: 30, status: 'denied' },
      { pid: 40, status: 'not-found' },
    ]);
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10, 20, 30, 40]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (4)' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量结束' }));
    });

    expect(await screen.findByText(/已结束 1\/4 个进程（受保护 1 · 权限不足 1 · 已退出 1）/)).toBeInTheDocument();
  });

  it('全部受保护时提示原因（UX-02 不再三合一）', async () => {
    vi.mocked(ipc.killByPids).mockResolvedValueOnce([{ pid: 10, status: 'protected' }]);
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (1)' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批量结束' }));
    });

    expect(await screen.findByText(/未结束任何进程：受保护 1/)).toBeInTheDocument();
  });

  it('keeps selection when batch confirmation is cancelled', () => {
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (1)' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([10]));
    expect(screen.getByRole('button', { name: '完成' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('批量结束确认框列出目标进程清单（UX-01）', () => {
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    act(() => {
      useProcessPanelStore.setState({ selectedPids: new Set([10, 20]) });
    });
    fireEvent.click(screen.getByRole('button', { name: '批量结束 (2)' }));

    const dialog = screen.getByRole('dialog', { name: '批量结束进程' });
    expect(dialog).toHaveTextContent('vite.exe (PID 10)');
    expect(dialog).toHaveTextContent('python.exe (PID 20)');
  });

  it('单杀成功显示成功反馈横幅（UX-03）', async () => {
    render(<><ToastHost /><ProcessPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: 'kill-single' }));
    fireEvent.click(screen.getByRole('button', { name: '结束进程' }));

    expect(await screen.findByText(/已结束 vite\.exe（PID 10）/)).toBeInTheDocument();
    expect(vi.mocked(ipc.killProcess)).toHaveBeenCalledWith(10);
  });
});
