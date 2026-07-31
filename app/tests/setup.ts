import '@testing-library/jest-dom';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup React DOM between tests
afterEach(() => {
  cleanup();
});

// Default mock for window.codemgr — individual tests override as needed.
// Mirrors the ExposedApi shape from electron/ipc-types.ts.
export function mockIpc(
  overrides: Partial<{
    fetchConnections: () => Promise<any[]>;
    fetchProcesses: () => Promise<any[]>;
    fetchCpu: () => Promise<any[]>;
    fetchPerf: () => Promise<any>;
    killProcess: () => Promise<boolean>;
    killByName: () => Promise<number>;
    killByPids: () => Promise<number>;
    listSnapshots: () => Promise<any[]>;
    saveSnapshot: () => Promise<any>;
    deleteSnapshot: () => Promise<boolean>;
    loadSnapshot: () => Promise<any>;
    listRunProfiles: () => Promise<any[]>;
    getRunStates: () => Promise<any[]>;
    saveRunProfile: () => Promise<any>;
    deleteRunProfile: () => Promise<boolean>;
    startProfile: () => Promise<any>;
    stopProfile: () => Promise<number>;
    restartProfile: () => Promise<any>;
    onRunUpdate: () => () => void;
  }> = {}
) {
  const base = {
    fetchConnections: vi.fn(() => Promise.resolve({ ok: true as const, data: [], sampledAt: Date.now() })),
    fetchProcesses: vi.fn(() => Promise.resolve({ ok: true as const, data: [], sampledAt: Date.now() })),
    fetchCpu: vi.fn(() => Promise.resolve([])),
    fetchPerf: vi.fn(() => Promise.resolve({ ok: true as const, data: null, sampledAt: Date.now() })),
    killProcess: vi.fn(() => Promise.resolve(true)),
    killByName: vi.fn(() => Promise.resolve(1)),
    killByPids: vi.fn(() => Promise.resolve(0)),
    // 进程快照对比（v2.2）：默认空列表 / save 返 null（store 测试按用例 override）
    listSnapshots: vi.fn(() => Promise.resolve([])),
    saveSnapshot: vi.fn(() => Promise.resolve(null)),
    deleteSnapshot: vi.fn(() => Promise.resolve(true)),
    loadSnapshot: vi.fn(() => Promise.resolve(null)),
    fetchGitIdentity: vi.fn(() => Promise.resolve(null)),
    listRunProfiles: vi.fn(() => Promise.resolve([])),
    getRunStates: vi.fn(() => Promise.resolve([])),
    saveRunProfile: vi.fn(() => Promise.resolve(null)),
    deleteRunProfile: vi.fn(() => Promise.resolve(true)),
    startProfile: vi.fn(() => Promise.resolve(null)),
    stopProfile: vi.fn(() => Promise.resolve(0)),
    restartProfile: vi.fn(() => Promise.resolve(null)),
    onRunUpdate: vi.fn(() => () => {}),
    ...overrides,
  };
  Object.defineProperty(window, 'codemgr', {
    value: base,
    writable: true,
    configurable: true,
  });
  return base;
}
