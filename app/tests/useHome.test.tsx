import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHomeStore } from '../src/store/homeStore';
import { useHome } from '../src/hooks/useHome';
import { usePerfStore } from '../src/store/perfStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useVisibilityStore } from '../src/store/visibilityStore';

beforeEach(() => {
  useHomeStore.getState().reset();
  usePerfStore.getState().reset();
  useProcessPanelStore.getState().reset();
  // M6：useHome 已接入可见性门控，测试间恢复默认（窗口前台 + home 面板可见）
  useVisibilityStore.setState({
    windowVisible: true,
    visible: { ...useVisibilityStore.getState().visible, home: true },
  });
});
afterEach(() => { vi.useRealTimers(); });

// 按 electron/ipc-types 的 PerfData 真实形状播种（gpu 为 available/totalPercent 结构，含 timestamp）
const seedPerf = () => usePerfStore.getState().setPerf({
  timestamp: Date.now(),
  cpu: { totalPercent: 88, perCore: [88] },
  memory: { totalBytes: 1e10, availableBytes: 2e9, usedPercent: 80 },
  disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 2e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
  networks: [],
  gpu: { available: false, totalPercent: 0, vramUsedBytes: 0, vramBudgetBytes: 0, perProcess: [], adapters: [] },
});

describe('useHome', () => {
  it('挂载后 2s tick 计算评估与问题', () => {
    vi.useFakeTimers();
    seedPerf();
    useProcessPanelStore.setState({
      processes: [{ pid: 42, ppid: 0, name: 'node.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 5e8, createTimeMs: 0, threadCount: 1, handleCount: 1 }],
      cpuMap: { 42: 120 },
      procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }, { ts: 2, cpu: 120, mem: 5e8 }] },
    });
    renderHook(() => useHome());
    // 第 1 tick（immediate refresh）：CPU 88 第 1 轮 → 无 system-cpu；进程 cpu 120 第 1 轮占位 → 无 process-cpu
    expect(useHomeStore.getState().assessment).not.toBeNull();
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'process-cpu')).toBe(false);
    act(() => { vi.advanceTimersByTime(2000); });
    // 第 2 轮：进程 cpu 连续 2 轮 → process-cpu 问题出现
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'process-cpu' && i.processId === 42)).toBe(true);
  });

  it('卸载停止轮询（running=false）', () => {
    const { unmount } = renderHook(() => useHome());
    unmount();
    expect(useHomeStore.getState().running).toBe(false);
  });

  it('perf 数据缺失时不计算（assessment 保持 null）', () => {
    renderHook(() => useHome());
    expect(useHomeStore.getState().assessment).toBeNull();
  });

  it('窗口不可见时暂停轮询（数据冻结），恢复可见立即补一次刷新', () => {
    vi.useFakeTimers();
    seedPerf();
    useProcessPanelStore.setState({
      processes: [{ pid: 42, ppid: 0, name: 'node.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 5e8, createTimeMs: 0, threadCount: 1, handleCount: 1 }],
      cpuMap: { 42: 120 },
      procHistory: { 42: [{ ts: 1, cpu: 120, mem: 5e8 }, { ts: 2, cpu: 120, mem: 5e8 }] },
    });
    renderHook(() => useHome());
    // tick1（immediate）：CPU 88 streak=1、进程 cpu 占位；tick2：process-cpu 问题出现
    act(() => { vi.advanceTimersByTime(2000); });
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'process-cpu' && i.processId === 42)).toBe(true);
    const frozen = useHomeStore.getState().assessment;
    // 窗口切后台 → pollable=false → interval 清理，数据冻结
    act(() => { useVisibilityStore.setState({ windowVisible: false }); });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(useHomeStore.getState().assessment).toBe(frozen);
    // 若轮询未停，streak 已 ≥3，system-cpu（连续 3 轮 >80%）应已出现——断言未出现证明已冻结
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'system-cpu')).toBe(false);
    // 恢复前台 → effect 重跑立即补一次 refresh → streak=3 → system-cpu 出现
    act(() => { useVisibilityStore.setState({ windowVisible: true }); });
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'system-cpu')).toBe(true);
  });
});
