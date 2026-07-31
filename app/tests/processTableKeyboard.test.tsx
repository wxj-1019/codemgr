import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ProcessTable } from '../src/components/ProcessTable';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useFocusStore } from '../src/store/focusStore';
import type { ProcessInfo } from '../electron/ipc-types';

// 与 processTableVirtual.test.tsx 相同的 store 种子模式（真实 zustand store 直接灌数据）。
// 行数 ≤ 100 走非虚拟化分支（虚拟化分支已由 processTableVirtual.test.tsx 覆盖）。
const sampleProc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1234, ppid: 0, name: 'node.exe', cmdline: 'node index.js', cwd: '',
  kernelTimeMs: 100, userTimeMs: 200, workingSetBytes: 100 * 1024 * 1024,
  createTimeMs: Date.now(), threadCount: 8, handleCount: 100,
  ...over,
});

const flatProcs = (n: number): ProcessInfo[] =>
  Array.from({ length: n }, (_, i) =>
    sampleProc({ pid: i + 1, name: `proc${i + 1}.exe` }));

const getRows = (container: HTMLElement) =>
  container.querySelectorAll('tbody tr[role="row"]');

describe('ProcessTable keyboard navigation (non-virtualized, ≤100 rows)', () => {
  beforeEach(() => {
    localStorage.clear();
    useProcessPanelStore.getState().reset();
    useFocusStore.getState().focus(null);
    useProcessPanelStore.getState().setProcesses(flatProcs(3));
  });

  it('makes the first visible row the initial keyboard entry point', () => {
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    const rows = getRows(container);
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown moves focus to next row (roving tabindex)', () => {
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRows(container)[0], { key: 'ArrowDown' });
    expect(getRows(container)[1]).toHaveAttribute('data-row-focused', 'true');
    expect(getRows(container)[1]).toHaveAttribute('tabindex', '0');
    expect(getRows(container)[0]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown then ArrowUp returns focus to first row', () => {
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRows(container)[0], { key: 'ArrowDown' });
    expect(getRows(container)[1]).toHaveAttribute('data-row-focused', 'true');
    fireEvent.keyDown(getRows(container)[1], { key: 'ArrowUp' });
    expect(getRows(container)[0]).toHaveAttribute('data-row-focused', 'true');
  });

  it('ArrowDown at last row does nothing (no wrap)', () => {
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRows(container)[2], { key: 'ArrowDown' });
    expect(getRows(container)[0]).not.toHaveAttribute('data-row-focused', 'true');
    expect(getRows(container)[2]).not.toHaveAttribute('data-row-focused', 'true');
  });

  it.each(['Enter', ' '])('%s focuses without selecting by default', (key) => {
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRows(container)[1], { key });
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 2, sourcePanel: 'process' });
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
  });

  it.each(['Enter', ' '])('%s toggles selection and focuses in multi-select mode', (key) => {
    const { container } = render(
      <ProcessTable multiSelectEnabled onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRows(container)[1], { key });
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set([2]));
    expect(useFocusStore.getState()).toMatchObject({ focusedPid: 2, sourcePanel: 'process' });
    fireEvent.keyDown(getRows(container)[1], { key });
    expect(useProcessPanelStore.getState().selectedPids).toEqual(new Set());
  });

  it('Home/End jump to first/last row', () => {
    const { container } = render(
      <ProcessTable onKillSingle={() => {}} onKillTree={() => {}} />,
    );
    fireEvent.keyDown(getRows(container)[1], { key: 'End' });
    expect(getRows(container)[2]).toHaveAttribute('data-row-focused', 'true');
    fireEvent.keyDown(getRows(container)[2], { key: 'Home' });
    expect(getRows(container)[0]).toHaveAttribute('data-row-focused', 'true');
  });
});
