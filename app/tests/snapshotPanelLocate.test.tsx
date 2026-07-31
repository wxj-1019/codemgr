import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotPanel } from '../src/components/SnapshotPanel';
import { useSnapshotStore } from '../src/store/snapshotStore';
import { useLayoutStore, containsPanel } from '../src/store/layoutStore';
import { mockIpc } from './setup';

const SNAP = {
  id: 'snapshot-1',
  name: 'Before refactor',
  createdAt: Date.now(),
  entries: [
    { pid: 100, createTimeMs: 1, name: 'node.exe', cmdline: 'node server.js', cwd: 'E:\\demo', workingSetBytes: 1024 },
  ],
};

function mockWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })));
}

describe('SnapshotPanel 定位反馈（UX-24）', () => {
  beforeEach(() => {
    localStorage.clear();
    useSnapshotStore.getState().reset();
    useLayoutStore.setState({ root: 'port', preset: null }); // 进程面板不在布局中
    mockIpc({
      listSnapshots: () => Promise.resolve([{ id: SNAP.id, name: SNAP.name, createdAt: SNAP.createdAt, count: 1 }]),
      loadSnapshot: () => Promise.resolve(SNAP),
      fetchProcesses: () => Promise.resolve({
        ok: true as const,
        data: [
          { pid: 200, ppid: 1, name: 'vite.exe', cmdline: 'vite', cwd: 'E:\\demo', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 0, createTimeMs: 2, threadCount: 1, handleCount: 1 },
        ],
        sampledAt: Date.now(),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('进程面板不在布局时，点击「定位」自动打开进程面板', async () => {
    mockWidth(800);
    render(<SnapshotPanel />);
    // 等快照列表加载完成 → 选中快照 → baseSnapshot 加载 → diff 出现 added 组
    fireEvent.click(await screen.findByText(SNAP.name));
    fireEvent.click(await screen.findByText('定位'));

    await waitFor(() => {
      expect(containsPanel(useLayoutStore.getState().root, 'process')).toBe(true);
    });
  });
});
