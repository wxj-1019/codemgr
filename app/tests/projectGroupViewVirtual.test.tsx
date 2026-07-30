import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ProjectGroupView } from '../src/components/ProjectGroupView';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

vi.mock('../src/lib/ipc', () => ({
  ipc: {
    openTarget: vi.fn(async () => ''),
    openExternalUrl: vi.fn(async () => ''),
    fetchCwd: vi.fn(async () => null),
  },
}));

const mkProc = (pid: number, cwd: string): ProcessInfo => ({
  pid, ppid: 1, name: `p${pid}.exe`, cmdline: '', cwd, kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 1024, createTimeMs: 0, threadCount: 1, handleCount: 1,
});

function seed(procs: ProcessInfo[], expandedDirs: string[]) {
  useProcessPanelStore.getState().setProcesses(procs);
  useProcessPanelStore.setState({ expandedGroups: new Set(expandedDirs) } as never);
}

describe('ProjectGroupView virtualization', () => {
  beforeEach(() => {
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    // jsdom 无布局：mock 800x600 视口（照 processTableVirtual 既有范式）
    vi.spyOn(window.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    vi.spyOn(window.HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(window.HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(10000);
    vi.spyOn(window.HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('总行数 ≤100 全部渲染（无 spacer）', () => {
    seed(
      [mkProc(1, 'D:\\a'), mkProc(2, 'D:\\a'), mkProc(3, 'D:\\b')],
      ['D:/a', 'D:/b'],
    );
    const { container } = render(
      <ProjectGroupView onKillSingle={vi.fn()} onKillGroup={vi.fn()} onKillTree={vi.fn()} />,
    );
    expect(container.querySelectorAll('[data-virtual-spacer]')).toHaveLength(0);
    // 2 组头 + 3 进程行
    expect(container.querySelectorAll('tbody tr').length).toBe(5);
  });

  it('总行数 >100 窗口化渲染（行数远小于全量）', () => {
    const procs = Array.from({ length: 300 }, (_, i) => mkProc(i + 1, 'D:\\big'));
    seed(procs, ['D:/big']);
    const { container } = render(
      <ProjectGroupView onKillSingle={vi.fn()} onKillGroup={vi.fn()} onKillTree={vi.fn()} />,
    );
    const rendered = container.querySelectorAll('tbody tr').length;
    expect(rendered).toBeLessThan(200); // 窗口 + spacer，远小于 301
    expect(container.querySelectorAll('[data-virtual-spacer]').length).toBeGreaterThan(0);
  });
});
