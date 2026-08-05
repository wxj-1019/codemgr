import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomePanel } from '../src/components/HomePanel';
import { ToastHost } from '../src/components/ToastHost';
import { useHomeStore } from '../src/store/homeStore';
import { usePerfStore } from '../src/store/perfStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { __resetToastStoreForTests } from '../src/store/toastStore';
import type { PerfData } from '../electron/ipc-types';

beforeEach(() => {
  __resetToastStoreForTests();
  useHomeStore.getState().reset();
  usePerfStore.getState().reset();
  useProcessPanelStore.getState().reset();
  // I1 复审：HomePanel 挂载即 useHome() 轮询，refresh 门控 = 布局叶子集。
  // 置为 perf+process 挂载布局 → refresh 走同步读 store 路径，不触发自驱采样
  // （否则会在未 mock window.codemgr 的测试环境里打一堆 fetch 失败日志）。
  useLayoutStore.setState({
    root: { direction: 'row', first: 'perf', second: 'process', splitPercentage: 70 },
    preset: null,
  });
  // HomePanel 经 useContainerWidth 依赖 ResizeObserver，jsdom 没有
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  // 恢复 spyOn(useHomeStore.getState(), 'refresh') 的原始实现，防止泄漏到后续用例
  vi.restoreAllMocks();
});

const seed = () => useHomeStore.setState({
  assessment: { level: 'attention', reasons: ['内存使用率 82%'] },
  issues: [{
    id: 'process-cpu:42', rule: 'process-cpu', severity: 'attention',
    title: 'node.exe CPU 占用持续偏高', detail: 'CPU 120%（占满 1.2 核）', processId: 42, action: 'locate-process',
  }],
});

// 按 electron/ipc-types 的 PerfData 真实形状播种（useHome.test.tsx 同款结构）
const makePerf = (overrides?: Partial<PerfData>): PerfData => ({
  timestamp: Date.now(),
  cpu: { totalPercent: 30, perCore: [30] },
  memory: { totalBytes: 1e10, availableBytes: 7e9, usedPercent: 30 },
  disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 5e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
  networks: [],
  gpu: { available: false, totalPercent: 0, vramUsedBytes: 0, vramBudgetBytes: 0, perProcess: [], adapters: [] },
  ...overrides,
});
const seedPerf = (p: PerfData) => usePerfStore.setState({ current: p });

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
    expect(screen.getByText('各项指标正常')).toBeInTheDocument();
  });

  it('评估未就绪时加载态', () => {
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('正在评估电脑状态…')).toBeInTheDocument();
  });

  it('快速动作含「一键优化」并打开清理对话框', () => {
    seed();
    render(<><ToastHost /><HomePanel /></>);
    fireEvent.click(screen.getByRole('button', { name: '一键优化' }));
    // 无候选进程时对话框显示空态文案（标题「一键优化」与按钮文案重复，改断言空态）
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('暂无可清理进程')).toBeInTheDocument();
  });

  it('自驱采样失败态：错误视图 + 重试按钮', () => {
    useHomeStore.setState({ assessment: null, error: '连续多次获取系统数据失败' });
    // 挂载即轮询会走「面板已挂载」路径把 error 清零，先 mock refresh 冻结状态
    const refreshSpy = vi
      .spyOn(useHomeStore.getState(), 'refresh')
      .mockImplementation(async () => {});
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('无法获取系统状态')).toBeInTheDocument();
    expect(screen.getByText('连续多次获取系统数据失败')).toBeInTheDocument();
    const callsBefore = refreshSpy.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refreshSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  it('CPU 卡显示趋势箭头', () => {
    seed();
    seedPerf(makePerf());
    // 末两点 cpuTotal 递增（10→15）→ ↑；内存 40→40 持平 → 不显示
    usePerfStore.setState({
      history: [
        { t: 1, cpuTotal: 10, memUsedPercent: 40, gpuTotal: 0 },
        { t: 2, cpuTotal: 15, memUsedPercent: 40, gpuTotal: 0 },
      ],
    });
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('磁盘卡显示盘符', () => {
    seed();
    seedPerf(makePerf({
      disks: [
        { name: 'C:', totalBytes: 1e12, freeBytes: 2e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 },
        { name: 'D:', totalBytes: 1e12, freeBytes: 8e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 },
      ],
    }));
    render(<><ToastHost /><HomePanel /></>);
    // 最小剩余百分比盘为 C:（20% < 80%）→ 值显示盘符 + 剩余语义（M2 消除方向歧义）
    expect(screen.getByText('C: 剩余 20%')).toBeInTheDocument();
  });

  it('数据陈旧时显示陈旧横幅', () => {
    seed();
    seedPerf(makePerf());
    // staleAt 早于 5s 阈值 → 内容态顶部出现陈旧提示（时间格式行内格式化，只断言前缀）
    usePerfStore.setState({ staleAt: Date.now() - 6000 });
    render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText(/数据陈旧（/)).toBeInTheDocument();
  });

  it('无问题时正向空态', () => {
    useHomeStore.setState({ assessment: { level: 'excellent', reasons: [] }, issues: [] });
    const { container } = render(<><ToastHost /><HomePanel /></>);
    expect(screen.getByText('各项指标正常')).toBeInTheDocument();
    // CheckCircle2 图标渲染（aria-hidden svg）
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
