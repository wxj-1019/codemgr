import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockIpc } from './setup';
import { RunProfilesPanel } from '../src/components/RunProfilesPanel';
import type { RunProfile, RunState } from '../electron/ipc-types';

const PROFILE: RunProfile = {
  id: '11111111-2222-3333-4444-555555555555',
  name: '前端 dev',
  command: 'pnpm',
  args: ['dev'],
  cwd: 'E:\\repo\\app',
};

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
    render(<RunProfilesPanel />);
    const badge = await screen.findByText('启动失败');
    expect(badge).toHaveAttribute('title', 'spawn pnpm ENOENT');
    expect(screen.getByRole('button', { name: '启动' })).toBeInTheDocument();
  });

  it('运行中 run 正常显示 PID 与停止/重启按钮（回归）', async () => {
    const running: RunState = {
      runId: 'run-r', profileId: PROFILE.id, pid: 1234,
      status: 'running', exitCode: null, startedAt: 1,
    };
    mockIpc({
      listRunProfiles: vi.fn(() => Promise.resolve([PROFILE])),
      getRunStates: vi.fn(() => Promise.resolve([running])),
    });
    render(<RunProfilesPanel />);
    await screen.findByText('PID 1234');
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重启' })).toBeInTheDocument();
  });
});
