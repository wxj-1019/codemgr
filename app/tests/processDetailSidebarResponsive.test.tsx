import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessInfo } from '../electron/ipc-types';
import { ProcessDetailSidebar } from '../src/components/ProcessDetailSidebar';
import { useFocusStore } from '../src/store/focusStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';

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

  it('does not apply viewport lg visibility classes to the empty state', () => {
    render(<ProcessDetailSidebar onKill={() => {}} onKillTree={() => {}} />);

    const message = screen.getByText('选中一个进程查看详情');
    expect(message.closest('aside')).not.toHaveClass('hidden', 'lg:flex', 'lg:block');
  });
});
