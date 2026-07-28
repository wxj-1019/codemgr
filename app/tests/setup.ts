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
  }> = {}
) {
  const base = {
    fetchConnections: vi.fn(() => Promise.resolve([])),
    fetchProcesses: vi.fn(() => Promise.resolve([])),
    fetchCpu: vi.fn(() => Promise.resolve([])),
    fetchPerf: vi.fn(() => Promise.resolve(null)),
    killProcess: vi.fn(() => Promise.resolve(true)),
    killByName: vi.fn(() => Promise.resolve(1)),
    ...overrides,
  };
  Object.defineProperty(window, 'codemgr', {
    value: base,
    writable: true,
    configurable: true,
  });
  return base;
}
