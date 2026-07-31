import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockIpc } from './setup';
import { RunProfilesPanel } from '../src/components/RunProfilesPanel';
import { ToastHost } from '../src/components/ToastHost';
import { useRunProfileStore } from '../src/store/runProfileStore';
import { __resetToastStoreForTests } from '../src/store/toastStore';
import type { RunProfile, RunState } from '../electron/ipc-types';

const PROFILE: RunProfile = {
  id: '11111111-2222-3333-4444-555555555555',
  name: '前端 dev',
  command: 'pnpm',
  args: ['dev'],
  cwd: 'E:\\repo\\app',
};

const RUNNING: RunState = {
  runId: 'run-r', profileId: PROFILE.id, pid: 1234,
  status: 'running', exitCode: null, startedAt: 1,
};

beforeEach(() => {
  useRunProfileStore.getState().reset();
  __resetToastStoreForTests();
});

describe('RunProfilesPanel 失败态展示（UX-05）', () => {
  it('run 失败时显示「启动失败」徽章并带错误信息，仍可重新启动', async () => {
    const failed: RunState = {
      runId: 'run-f', profileId: PROFILE.id, pid: 0,
      status: 'failed', exitCode: null, startedAt: 1, error: 'spawn pnpm ENOENT',
    };
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([failed])),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    const badge = await screen.findByText('启动失败');
    expect(badge).toHaveAttribute('title', 'spawn pnpm ENOENT');
    expect(screen.getByRole('button', { name: '启动' })).toBeInTheDocument();
  });

  it('运行中 run 正常显示 PID 与停止/重启按钮（回归）', async () => {
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([RUNNING])),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    await screen.findByText('PID 1234');
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重启' })).toBeInTheDocument();
  });
});

describe('RunProfilesPanel 操作反馈（UX-07/UX-17）', () => {
  it('删除失败显示失败反馈（不再静默）', async () => {
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([])),
      deleteRunProfile: vi.fn(() => Promise.resolve(false)),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    await screen.findByText('前端 dev');
    fireEvent.click(screen.getByRole('button', { name: '删' }));
    fireEvent.click(screen.getByRole('button', { name: '删除配置' }));
    expect(await screen.findByText(/删除失败/)).toBeInTheDocument();
  });

  it('停止杀 0 个进程时显示失败反馈', async () => {
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([RUNNING])),
      stopProfile: vi.fn(() => Promise.resolve(0)),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    await screen.findByText('PID 1234');
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(await screen.findByText(/未结束任何进程/)).toBeInTheDocument();
  });

  it('停止成功显示已停止反馈（含结束数量）', async () => {
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([RUNNING])),
      stopProfile: vi.fn(() => Promise.resolve(3)),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    await screen.findByText('PID 1234');
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(await screen.findByText(/已停止（结束 3 个进程）/)).toBeInTheDocument();
  });

  it('启动失败（start 返 null）显示失败反馈而非原生 alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([])),
      startProfile: vi.fn(() => Promise.resolve(null)),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    await screen.findByText('前端 dev');
    fireEvent.click(screen.getByRole('button', { name: '启动' }));
    expect(await screen.findByText(/启动失败/)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('重试成功后旧失败徽章不残留（仅无运行中 run 时展示失败）', async () => {
    const failed: RunState = {
      runId: 'run-f', profileId: PROFILE.id, pid: 0,
      status: 'failed', exitCode: null, startedAt: 1, error: 'spawn ENOENT',
    };
    const running: RunState = {
      runId: 'run-r', profileId: PROFILE.id, pid: 1234,
      status: 'running', exitCode: null, startedAt: 2,
    };
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([failed, running])),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    await screen.findByText('PID 1234');
    expect(screen.queryByText('启动失败')).not.toBeInTheDocument();
  });

  it('列表加载失败显示错误横幅（不再误报「尚无配置」）', async () => {
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.reject(new Error('read failed'))),
      getRunStates: vi.fn(() => Promise.resolve([])),
    });
    render(<><ToastHost /><RunProfilesPanel /></>);
    expect(await screen.findByText(/加载 Run Profiles 失败/)).toBeInTheDocument();
  });
});
