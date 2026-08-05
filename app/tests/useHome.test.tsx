import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useHomeStore } from '../src/store/homeStore';
import { useHome } from '../src/hooks/useHome';
import { usePerfStore } from '../src/store/perfStore';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useVisibilityStore } from '../src/store/visibilityStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { mockIpc } from './setup';
import type { PerfData } from '../electron/ipc-types';

let ipcMock: ReturnType<typeof mockIpc>;

beforeEach(() => {
  useHomeStore.getState().reset();
  usePerfStore.getState().reset();
  useProcessPanelStore.getState().reset();
  // M6：useHome 已接入可见性门控，测试间恢复默认（窗口前台 + home 可见）
  useVisibilityStore.setState({
    windowVisible: true,
    visible: { home: true, port: true, process: true, perf: true, snapshot: true },
  });
  // I1 复审：自驱采样门控 = 布局树叶子集。默认测试布局 = perf+process 双面板挂载
  // （refresh 同步读共享 store 的路径）；自驱采样用例单独把 root 置为 'home'。
  useLayoutStore.setState({
    root: { direction: 'row', first: 'perf', second: 'process', splitPercentage: 70 },
    preset: null,
  });
  // I1：refresh 在数据源面板未挂载时会自驱采样 → 预置 window.codemgr mock
  ipcMock = mockIpc();
});
afterEach(() => { vi.useRealTimers(); });

// 按 electron/ipc-types 的 PerfData 真实形状播种（gpu 为 available/totalPercent 结构，含 timestamp）
const makePerf = (): PerfData => ({
  timestamp: Date.now(),
  cpu: { totalPercent: 88, perCore: [88] },
  memory: { totalBytes: 1e10, availableBytes: 2e9, usedPercent: 80 },
  disks: [{ name: 'C:', totalBytes: 1e12, freeBytes: 2e11, readBytesPerSec: 0, writeBytesPerSec: 0, activePercent: 0 }],
  networks: [],
  gpu: { available: false, totalPercent: 0, vramUsedBytes: 0, vramBudgetBytes: 0, perProcess: [], adapters: [] },
});
const seedPerf = () => usePerfStore.getState().setPerf(makePerf());

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
    // I1：perf/process 已挂载（布局叶子集含两者）→ 直接读共享 store，不重复采样
    expect(ipcMock.fetchPerf).not.toHaveBeenCalled();
    expect(ipcMock.fetchProcesses).not.toHaveBeenCalled();
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

  it('数据源面板未挂载时自驱采样（classic=home 首屏不再空转）', async () => {
    ipcMock = mockIpc({
      fetchPerf: vi.fn(async () => ({ ok: true, data: makePerf(), sampledAt: Date.now() })),
      fetchProcesses: vi.fn(async () => ({
        ok: true,
        data: [{ pid: 42, ppid: 0, name: 'node.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 5e8, createTimeMs: 0, threadCount: 1, handleCount: 1 }],
        sampledAt: Date.now(),
      })),
      fetchCpu: vi.fn(async () => [{ pid: 42, cpuPercent: 120 }]),
    });
    // classic=home 首屏：布局叶子只有 'home' → perf/process 未挂载 → home 代为采样
    useLayoutStore.setState({ root: 'home', preset: 'classic' });
    renderHook(() => useHome());

    await waitFor(() => expect(useHomeStore.getState().assessment).not.toBeNull());
    // 布局门控触发自驱采样（真实路径，非手工可见性标志）
    expect(ipcMock.fetchPerf).toHaveBeenCalled();
    expect(ipcMock.fetchProcesses).toHaveBeenCalled();
    expect(ipcMock.fetchCpu).toHaveBeenCalled();
    // 共享 store 同步被采样（首页数据与面板同源，M4 无空转）
    expect(usePerfStore.getState().current?.cpu.totalPercent).toBe(88);
    expect(useProcessPanelStore.getState().processes.some((p) => p.pid === 42)).toBe(true);
    expect(useProcessPanelStore.getState().cpuMap[42]).toBe(120);
    // 第 1 轮：进程 cpu 120 第 1 轮占位 → 无 process-cpu 问题
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'process-cpu')).toBe(false);
  });

  it('自驱采样下 memory-growth 规则可触发（classic=home 布局）', async () => {
    vi.useFakeTimers();
    // 三轮 refresh 各返回递增 mem，模拟真实进程内存爬升（500→560→620MB）
    const mems = [5e8, 5.6e8, 6.2e8];
    let call = 0;
    ipcMock = mockIpc({
      fetchPerf: vi.fn(async () => ({ ok: true, data: makePerf(), sampledAt: Date.now() })),
      fetchProcesses: vi.fn(async () => ({
        ok: true,
        data: [{
          pid: 42, ppid: 0, name: 'node.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0,
          workingSetBytes: mems[Math.min(call++, mems.length - 1)],
          createTimeMs: 0, threadCount: 1, handleCount: 1,
        }],
        sampledAt: Date.now(),
      })),
      fetchCpu: vi.fn(async () => [{ pid: 42, cpuPercent: 10 }]),
    });
    useLayoutStore.setState({ root: 'home', preset: 'classic' });
    renderHook(() => useHome());
    // 首帧（immediate）自驱采样先跑完，再依次推进 tick2/tick3（async act 保证
    // refresh 的 await 链完整 drain，busy 守卫不丢 tick）
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    // 修复前 procHistory 恒空（self-sampling 不喂 appendHistory）→ 3 轮后应采到 3 点
    const hist = useProcessPanelStore.getState().procHistory[42];
    expect(hist?.length).toBe(3);
    expect(hist?.map((p) => p.mem)).toEqual([5e8, 5.6e8, 6.2e8]);
    // 末 3 样本 5e8→5.6e8→6.2e8 递增且增幅 24% > 15% → memory-growth 触发
    expect(useHomeStore.getState().issues.some((i) => i.rule === 'memory-growth' && i.processId === 42)).toBe(true);
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
