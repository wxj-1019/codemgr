import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mockIpc } from './setup';
import { useRunProfiles } from '../src/hooks/useRunProfiles';
import { useRunProfileStore } from '../src/store/runProfileStore';
import type { RunState } from '../electron/ipc-types';

const RUN_A: RunState = { runId: 'run-a', profileId: 'p-1', pid: 42, status: 'running', exitCode: null, startedAt: 100 };
const RUN_B_EXITED: RunState = { runId: 'run-b', profileId: 'p-1', pid: 43, status: 'exited', exitCode: 1, startedAt: 200 };

describe('useRunProfiles 挂载全量同步（UX-06）', () => {
  beforeEach(() => {
    useRunProfileStore.getState().reset();
  });

  it('挂载即拉取当前运行态快照并写入 store', async () => {
    const api = mockIpc({ getRunStates: vi.fn(() => Promise.resolve([RUN_A])) });
    renderHook(() => useRunProfiles());
    await act(async () => { await Promise.resolve(); });
    expect(useRunProfileStore.getState().runs).toEqual([RUN_A]);
    expect(api.getRunStates).toHaveBeenCalledTimes(1);
  });

  it('快照在途时收到的事件不丢（缓冲后重放）', async () => {
    let resolveStates!: (v: RunState[]) => void;
    let onUpdate!: (u: RunState) => void;
    mockIpc({
      getRunStates: vi.fn(() => new Promise<RunState[]>((res) => { resolveStates = res; })),
      onRunUpdate: vi.fn((cb: (u: RunState) => void) => { onUpdate = cb; return () => {}; }),
    });
    renderHook(() => useRunProfiles());
    onUpdate(RUN_B_EXITED); // 快照未返回时事件入缓冲
    await act(async () => { resolveStates([RUN_A]); await Promise.resolve(); });
    const runs = useRunProfileStore.getState().runs;
    expect(runs).toHaveLength(2); // 快照 + 在途事件都生效
    expect(runs.find((r) => r.runId === 'run-b')!.status).toBe('exited');
  });

  it('同步完成后再来事件直接应用（不丢更新）', async () => {
    let onUpdate!: (u: RunState) => void;
    mockIpc({
      getRunStates: vi.fn(() => Promise.resolve([])),
      onRunUpdate: vi.fn((cb: (u: RunState) => void) => { onUpdate = cb; return () => {}; }),
    });
    renderHook(() => useRunProfiles());
    await act(async () => { await Promise.resolve(); });
    act(() => { onUpdate(RUN_A); });
    expect(useRunProfileStore.getState().runs).toEqual([RUN_A]);
  });

  it('快照拉取失败时缓冲事件仍重放', async () => {
    let onUpdate!: (u: RunState) => void;
    mockIpc({
      getRunStates: vi.fn(() => Promise.reject(new Error('ipc down'))),
      onRunUpdate: vi.fn((cb: (u: RunState) => void) => { onUpdate = cb; return () => {}; }),
    });
    renderHook(() => useRunProfiles());
    onUpdate(RUN_A);
    await act(async () => { await Promise.resolve(); });
    expect(useRunProfileStore.getState().runs).toEqual([RUN_A]);
  });

  it('卸载时取消订阅', () => {
    const unsub = vi.fn();
    mockIpc({ onRunUpdate: vi.fn(() => unsub) });
    const { unmount } = renderHook(() => useRunProfiles());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe('runProfileStore.setRuns', () => {
  beforeEach(() => {
    useRunProfileStore.getState().reset();
  });

  it('整体替换 runs（快照语义）', () => {
    const s = useRunProfileStore.getState();
    s.setRuns([RUN_A]);
    expect(useRunProfileStore.getState().runs).toEqual([RUN_A]);
    s.setRuns([RUN_B_EXITED]);
    expect(useRunProfileStore.getState().runs).toEqual([RUN_B_EXITED]);
  });
});
