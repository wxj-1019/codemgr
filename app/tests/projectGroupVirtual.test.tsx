import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { ProcessInfo } from '../electron/ipc-types';

const { scrollToIndexSpy, wrappedVirtualizers } = vi.hoisted(() => ({
  scrollToIndexSpy: vi.fn(),
  wrappedVirtualizers: new WeakSet<object>(),
}));

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const virtualizer = actual.useVirtualizer(options);
      if (!wrappedVirtualizers.has(virtualizer)) {
        const scrollToIndex = virtualizer.scrollToIndex.bind(virtualizer);
        virtualizer.scrollToIndex = (index, alignOptions) => {
          scrollToIndexSpy(index, alignOptions);
          scrollToIndex(index, alignOptions);
        };
        wrappedVirtualizers.add(virtualizer);
      }
      return virtualizer;
    },
  };
});

import { ProjectGroupView } from '../src/components/ProjectGroupView';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useFocusStore } from '../src/store/focusStore';

vi.mock('../src/lib/ipc', () => ({
  ipc: { fetchCwd: vi.fn(() => Promise.resolve(null)) },
}));

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 10, ppid: 0, name: 'node.exe', cmdline: 'node x.js', cwd: 'C:\\work\\app',
  kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 100, createTimeMs: 0,
  threadCount: 1, handleCount: 1, ...over,
});

// 同一 cwd → 单个项目组，便于测"一组 300 进程"的极端场景
const manyProcs = (n: number): ProcessInfo[] =>
  Array.from({ length: n }, (_, i) => proc({ pid: i + 1, name: `node${i + 1}.exe` }));

const props = { onKillSingle: vi.fn(), onKillGroup: vi.fn(), onKillTree: vi.fn() };

describe('ProjectGroupView 虚拟化（UX-13）', () => {
  beforeEach(() => {
    localStorage.clear();
    scrollToIndexSpy.mockClear();
    useProcessPanelStore.getState().reset();
    useFocusStore.getState().focus(null);

    // jsdom 中 offsetWidth/offsetHeight 恒为 0，virtualizer 测不到视口高度就不产出
    // 可见项。mock 成 800x600 固定视口（同 processTableVirtual.test.tsx 模式）。
    vi.spyOn(window.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    vi.spyOn(window.HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);

    // jsdom 没有 Element.scrollTo；补实现让 scrollToIndex 生效并派发 scroll 事件。
    (window.HTMLElement.prototype as any).scrollTo = function (
      this: HTMLElement,
      arg?: number | ScrollToOptions,
    ) {
      this.scrollTop = typeof arg === 'number' ? arg : arg?.top ?? 0;
      this.dispatchEvent(new Event('scroll'));
    };

    vi.spyOn(window.HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(9000);
    vi.spyOn(window.HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('超过阈值时只渲染可视窗口内的行（300 进程不整组铺进 DOM）', () => {
    useProcessPanelStore.setState({
      processes: manyProcs(300),
      expandedGroups: new Set(['C:/work/app']),
      filter: '',
    });
    const { container } = render(<ProjectGroupView {...props} />);
    const rows = container.querySelectorAll('tbody tr[role="row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100); // 虚拟窗口 + overscan ≈ 40，远小于 300
    // 组头行仍在
    expect(container.querySelector('tbody tr')).not.toBeNull();
  });

  it('未达阈值保持全量渲染（回归）', () => {
    useProcessPanelStore.setState({
      processes: manyProcs(50),
      expandedGroups: new Set(['C:/work/app']),
      filter: '',
    });
    const { container } = render(<ProjectGroupView {...props} />);
    expect(container.querySelectorAll('tbody tr[role="row"]')).toHaveLength(50);
  });

  it('虚拟化下键盘导航仍可用（ArrowDown 触发 scrollToIndex）', async () => {
    useProcessPanelStore.setState({
      processes: manyProcs(300),
      expandedGroups: new Set(['C:/work/app']),
      filter: '',
    });
    const { container } = render(<ProjectGroupView {...props} />);
    const firstRow = container.querySelector<HTMLTableRowElement>('tbody tr[data-pid]');
    expect(firstRow).not.toBeNull();
    firstRow!.focus();
    fireEvent.keyDown(firstRow!, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(scrollToIndexSpy).toHaveBeenCalled();
    });
  });
});
