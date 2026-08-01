import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, fireEvent, waitFor } from '@testing-library/react';

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

import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import type { ProcessInfo } from '../electron/ipc-types';

const sampleProc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1234, ppid: 0, name: 'node.exe', cmdline: 'node index.js', cwd: '',
  kernelTimeMs: 100, userTimeMs: 200, workingSetBytes: 100 * 1024 * 1024,
  createTimeMs: Date.now(), threadCount: 8, handleCount: 100,
  ...over,
});

// 全部 ppid=0 → 平铺根节点，行数 == 进程数
const flatProcs = (n: number): ProcessInfo[] =>
  Array.from({ length: n }, (_, i) =>
    sampleProc({ pid: i + 1, name: `proc${i + 1}.exe` }));

const seedProcesses = (n: number) => {
  useProcessPanelStore.getState().setProcesses(flatProcs(n));
};

const getRenderedRows = (container: HTMLElement) =>
  container.querySelectorAll('tbody tr[role="row"]');

describe('ProcessTable virtualization', () => {
  beforeEach(() => {
    localStorage.clear();
    scrollToIndexSpy.mockClear();
    useProcessPanelStore.getState().reset();

    // jsdom 中 offsetWidth/offsetHeight 恒为 0，virtualizer 测不到视口高度就不产出
    // 可见项（virtual-core 3.17 的 getRect 读 offset* 而非 getBoundingClientRect）。
    // mock 成 800x600 的固定视口（虚拟行不做逐行测量，全局 mock 无副作用）。
    vi.spyOn(window.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    vi.spyOn(window.HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);

    // jsdom 没有 Element.scrollTo（virtual-core 用可选链调用，缺了也不崩，但
    // scrollToIndex 不会生效）。补上实现：写 scrollTop 并派发 scroll 事件，
    // 让 virtualizer 的 offset 观察者收到新滚动位置。
    (window.HTMLElement.prototype as any).scrollTo = function (
      this: HTMLElement,
      arg?: number | ScrollToOptions,
    ) {
      this.scrollTop = typeof arg === 'number' ? arg : arg?.top ?? 0;
      this.dispatchEvent(new Event('scroll'));
    };

    // jsdom 的 scrollHeight/clientHeight 恒为 0；scrollToIndex 到末行时
    // getMaxScrollOffset() = scrollHeight - clientHeight 会被钳成 0（纯 jsdom 限制，
    // 浏览器里滚动容器有真实内容高度）。mock 成内容总高 11100 = 300 行 × 37px、视口 600。
    vi.spyOn(window.HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(11100);
    vi.spyOn(window.HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all rows without spacers when row count <= 100', () => {
    seedProcesses(50);
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    expect(getRenderedRows(container)).toHaveLength(50);
    expect(container.querySelector('[data-virtual-spacer]')).toBeNull();
  });

  it('renders only a window of rows when row count > 100', () => {
    seedProcesses(300);
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    const rendered = getRenderedRows(container);
    // 600px 视口 / 37px 行高 ≈ 16 行 + overscan，远小于 300 全量
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    // 首屏在顶部：下方应有占位行撑出总高度
    const bottomSpacer = container.querySelector('[data-virtual-spacer="bottom"] td');
    expect(bottomSpacer).not.toBeNull();
    const spacerHeight = parseInt((bottomSpacer as HTMLElement).style.height, 10);
    expect(spacerHeight).toBeGreaterThan(0);
  });

  it('keyboard navigation still works in virtualized mode (roving tabindex + Enter select)', () => {
    seedProcesses(300);
    const { container } = render(
      <ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRenderedRows(container)[0], { key: 'ArrowDown' });
    expect(getRenderedRows(container)[1]).toHaveAttribute('data-row-focused', 'true');
    expect(getRenderedRows(container)[1]).toHaveAttribute('tabindex', '0');
    expect(getRenderedRows(container)[0]).toHaveAttribute('tabindex', '-1');

    // Enter 选中焦点行（pid 锚定：第二行 pid=2）
    fireEvent.keyDown(getRenderedRows(container)[1], { key: 'Enter' });
    expect(useProcessPanelStore.getState().selectedPids.has(2)).toBe(true);
  });

  it('End scrolls the virtualized list so the last row is rendered and focused', async () => {
    seedProcesses(300);
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    expect(container.textContent).not.toContain('proc300.exe');

    fireEvent.keyDown(getRenderedRows(container)[0], { key: 'End' });

    // scrollToIndex →（mock 的 scrollTo + scroll 事件）→ 重渲染出末行并聚焦
    await waitFor(() => {
      const focused = container.querySelector('[data-row-focused="true"]');
      expect(focused).not.toBeNull();
      expect(focused!.textContent).toContain('proc300.exe');
    });
    // Home 跳回首行（scrollToIndex(0)，对称路径）
    fireEvent.keyDown(container.querySelector('[data-row-focused="true"]')!, { key: 'Home' });
    await waitFor(() => {
      const focused = container.querySelector('[data-row-focused="true"]');
      expect(focused!.textContent).toContain('proc1.exe');
    });
  });

  it('scrolls to and focuses the logical fallback row when the focused row is removed off-window', async () => {
    seedProcesses(300);
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );

    fireEvent.keyDown(getRenderedRows(container)[0], { key: 'End' });
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('data-pid', '300');
    });
    expect(container.querySelector('[data-pid="1"]')).toBeNull();

    scrollToIndexSpy.mockClear();
    act(() => {
      useProcessPanelStore.getState().setProcesses(flatProcs(299));
    });

    await waitFor(() => {
      expect(scrollToIndexSpy).toHaveBeenCalledWith(0, { align: 'auto' });
      const fallback = container.querySelector<HTMLTableRowElement>('[data-pid="1"]');
      expect(fallback).toHaveAttribute('tabindex', '0');
      expect(document.activeElement).toBe(fallback);
    });
  });
});
