import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomePanel } from '../src/components/HomePanel';
import { ToastHost } from '../src/components/ToastHost';
import { useHomeStore } from '../src/store/homeStore';
import { usePerfStore } from '../src/store/perfStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => {
  __resetToastStoreForTests();
  useHomeStore.getState().reset();
  usePerfStore.getState().reset();
  useProcessPanelStore.getState().reset();
  // HomePanel 经 useContainerWidth 依赖 ResizeObserver，jsdom 没有
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const seed = () => useHomeStore.setState({
  assessment: { level: 'attention', reasons: ['内存使用率 82%'] },
  issues: [{
    id: 'process-cpu:42', rule: 'process-cpu', severity: 'attention',
    title: 'node.exe CPU 占用持续偏高', detail: 'CPU 120%（占满 1.2 核）', processId: 42, action: 'locate-process',
  }],
});

describe('HomePanel', () => {
  it('渲染评估横幅（分级 + reasons）', () => {
    seed();
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('需要关注')).toBeInTheDocument();
    expect(screen.getByText('内存使用率 82%')).toBeInTheDocument();
  });

  it('渲染问题清单与处理按钮', () => {
    seed();
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText(/node\.exe CPU 占用持续偏高/)).toBeInTheDocument();
    // M4：按钮 aria-label=`处理：${title}`，accessible name 为完整标签
    fireEvent.click(screen.getByRole('button', { name: /^处理：node\.exe CPU 占用持续偏高$/ }));
    expect(useProcessPanelStore.getState().selectedPids.has(42)).toBe(true);
  });

  it('无问题时空态', () => {
    useHomeStore.setState({ assessment: { level: 'excellent', reasons: [] }, issues: [] });
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('暂无异常')).toBeInTheDocument();
  });

  it('评估未就绪时加载态', () => {
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('正在评估电脑状态…')).toBeInTheDocument();
  });
});
