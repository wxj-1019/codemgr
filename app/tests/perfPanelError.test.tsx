import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerfPanel } from '../src/components/PerfPanel';
import { usePerfStore } from '../src/store/perfStore';
import type { PerfData } from '../electron/ipc-types';

vi.mock('../src/hooks/usePerf', () => ({ usePerf: vi.fn() }));

const perfData: PerfData = {
  cpu: { totalPercent: 10, perCore: [10] },
  memory: { totalBytes: 1000, availableBytes: 500, usedPercent: 50 },
  disks: [],
  networks: [],
  gpu: { available: false, totalPercent: 0, vramUsedBytes: 0, vramBudgetBytes: 0, perProcess: [], adapters: [] },
  timestamp: Date.now(),
};

describe('PerfPanel 错误细节（UX-28）', () => {
  beforeEach(() => {
    localStorage.clear();
    usePerfStore.getState().reset();
    // recharts ResponsiveContainer 依赖 ResizeObserver，jsdom 没有
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({
      observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('有数据后出错时显示错误详情横幅（不再只显示「数据陈旧」）', () => {
    usePerfStore.setState({ current: perfData, error: 'PERF_FAILED: boom', staleAt: null });
    render(<PerfPanel />);
    expect(screen.getByText(/上次刷新失败：PERF_FAILED: boom/)).toBeInTheDocument();
  });

  it('无错误时不显示横幅', () => {
    usePerfStore.setState({ current: perfData, error: null, staleAt: null });
    render(<PerfPanel />);
    expect(screen.queryByText(/上次刷新失败/)).not.toBeInTheDocument();
  });
});
