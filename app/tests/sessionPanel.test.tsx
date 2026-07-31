import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionPanel } from '../src/components/SessionPanel';
import { ToastHost } from '../src/components/ToastHost';
import { useSessionStore } from '../src/store/sessionStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { ipc } from '../src/lib/ipc';
import { __resetToastStoreForTests } from '../src/store/toastStore';
import type { ProcessInfo } from '../electron/ipc-types';

vi.mock('../src/hooks/useSessions', () => ({ useSessions: vi.fn() }));
vi.mock('../src/lib/ipc', () => ({
  ipc: { killTree: vi.fn(() => Promise.resolve(3)) },
}));

const proc = (pid: number, name: string): ProcessInfo => ({
  pid, ppid: 1, name, cmdline: `${name} x`, cwd: '',
  kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 0, createTimeMs: 0, threadCount: 1, handleCount: 1,
});

const SESSION = { id: 's1', rootPid: 100, kind: 'ai', rootLabel: 'claude', pids: [100], createTimeMs: 1 };

describe('SessionPanel 空态与停止反馈（UX-16/UX-17 补漏）', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    useProcessPanelStore.getState().reset();
    vi.mocked(ipc.killTree).mockResolvedValue(3);
    __resetToastStoreForTests();
  });

  it('进程扫描未完成时不误报「未检测到」', () => {
    useProcessPanelStore.setState({ processes: [], loading: true, error: null });
    render(<><ToastHost /><SessionPanel /></>);
    expect(screen.getByText(/正在扫描进程/)).toBeInTheDocument();
    expect(screen.queryByText(/未检测到 AI 开发会话/)).not.toBeInTheDocument();
  });

  it('扫描完成无会话显示正常空态', () => {
    useProcessPanelStore.setState({ processes: [], loading: false, error: null });
    render(<><ToastHost /><SessionPanel /></>);
    expect(screen.getByText(/未检测到 AI 开发会话/)).toBeInTheDocument();
  });

  it('停止杀 0 个进程显示失败反馈（不再原生 alert）', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    useSessionStore.getState().setSessions([SESSION]);
    useProcessPanelStore.setState({ processes: [proc(100, 'claude')], loading: false, error: null });
    vi.mocked(ipc.killTree).mockResolvedValueOnce(0);
    render(<><ToastHost /><SessionPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    fireEvent.click(screen.getByRole('button', { name: '停止会话' }));
    expect(await screen.findByText(/未结束任何进程/)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('停止成功显示已停止反馈（含结束数量）', async () => {
    useSessionStore.getState().setSessions([SESSION]);
    useProcessPanelStore.setState({ processes: [proc(100, 'claude')], loading: false, error: null });
    render(<><ToastHost /><SessionPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    fireEvent.click(screen.getByRole('button', { name: '停止会话' }));
    expect(await screen.findByText(/已停止（结束 3 个进程）/)).toBeInTheDocument();
  });
});
