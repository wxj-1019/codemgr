import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessInfo } from '../electron/ipc-types';
import { ProcessDetailSidebar } from '../src/components/ProcessDetailSidebar';
import { useFocusStore } from '../src/store/focusStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { usePortRadarStore } from '../src/store/portRadarStore';

const processInfo: ProcessInfo = {
  pid: 4321,
  ppid: 1,
  name: 'node.exe',
  cmdline: 'node server.js',
  cwd: 'E:\\project\\demo',
  kernelTimeMs: 10,
  userTimeMs: 20,
  workingSetBytes: 1024,
  createTimeMs: Date.now() - 1000,
  threadCount: 2,
  handleCount: 8,
};

describe('ProcessDetailSidebar tile responsiveness', () => {
  beforeEach(() => {
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useProcessPanelStore.getState().setProcesses([processInfo]);
    useFocusStore.getState().focus(null);
  });

  it('shows a process focused from another panel without checkbox selection', () => {
    useFocusStore.getState().focus(processInfo.pid, 'port');
    render(<ProcessDetailSidebar onKill={() => {}} onKillTree={() => {}} />);

    expect(screen.getByText('node.exe')).toBeInTheDocument();
    expect(screen.getByText('PID 4321')).toBeInTheDocument();
    expect(screen.getByText('node.exe').closest('aside')).not.toHaveClass('hidden');
  });

  it('always inspects the focused process regardless of batch selection mode', () => {
    const focusedProcess = { ...processInfo, pid: 9876, name: 'python.exe' };
    const otherSelectedProcess = { ...processInfo, pid: 2468, name: 'vite.exe' };
    useProcessPanelStore.getState().setProcesses([processInfo, focusedProcess, otherSelectedProcess]);
    useProcessPanelStore.setState({ selectedPids: new Set([processInfo.pid]) });
    useFocusStore.getState().focus(focusedProcess.pid, 'port');

    const { rerender } = render(
      <ProcessDetailSidebar onKill={() => {}} onKillTree={() => {}} />,
    );
    expect(screen.getByText('python.exe')).toBeInTheDocument();
    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();

    rerender(
      <ProcessDetailSidebar multiSelectEnabled onKill={() => {}} onKillTree={() => {}} />,
    );
    expect(screen.getByText('python.exe')).toBeInTheDocument();
    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();

    act(() => {
      useProcessPanelStore.setState({
        selectedPids: new Set([processInfo.pid, otherSelectedProcess.pid]),
      });
    });
    expect(screen.getByText('python.exe')).toBeInTheDocument();
    expect(screen.queryByText('已选 2 个进程。选择单个查看详情。')).not.toBeInTheDocument();
  });

  it('does not apply viewport lg visibility classes to the empty state', () => {
    render(<ProcessDetailSidebar onKill={() => {}} onKillTree={() => {}} />);

    const message = screen.getByText('选中一个进程查看详情');
    expect(message.closest('aside')).not.toHaveClass('hidden', 'lg:flex', 'lg:block');
  });

  it('shows the focused process listening ports（UX-18 进程→端口联动）', () => {
    usePortRadarStore.getState().setConnections([
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: processInfo.pid, processName: 'node.exe' },
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 5173, remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: processInfo.pid, processName: 'node.exe' },
      { protocol: 'tcp', localAddr: '0.0.0.0', localPort: 8080, remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 999, processName: 'other.exe' },
    ]);
    useFocusStore.getState().focus(processInfo.pid, 'port');
    render(<ProcessDetailSidebar onKill={() => {}} onKillTree={() => {}} />);

    expect(screen.getByText('监听端口')).toBeInTheDocument();
    expect(screen.getByText(/3000/)).toBeInTheDocument();
    expect(screen.getByText(/5173/)).toBeInTheDocument();
    // 非本进程的端口不出现
    expect(screen.queryByText(/8080/)).not.toBeInTheDocument();
  });
});
