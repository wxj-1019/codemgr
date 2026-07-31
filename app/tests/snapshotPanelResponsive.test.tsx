import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotPanel } from '../src/components/SnapshotPanel';
import { ToastHost } from '../src/components/ToastHost';
import { useSnapshotStore } from '../src/store/snapshotStore';
import { mockIpc } from './setup';

const snapshot = {
  id: 'snapshot-1',
  name: 'Before refactor',
  createdAt: Date.now(),
  count: 2,
};

function mockWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })));
}

describe('SnapshotPanel responsive controls', () => {
  beforeEach(() => {
    localStorage.clear();
    useSnapshotStore.getState().reset();
    mockIpc({
      listSnapshots: () => Promise.resolve([snapshot]),
      loadSnapshot: () => Promise.resolve(null),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses compact top controls below 480px', async () => {
    mockWidth(479);
    render(<><ToastHost /><SnapshotPanel /></>);

    expect(await screen.findByTestId('snapshot-compact-controls')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-sidebar')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '对比快照' })).toBeInTheDocument();
  });

  it('keeps the sidebar at 480px and above', async () => {
    mockWidth(480);
    render(<><ToastHost /><SnapshotPanel /></>);

    await waitFor(() => expect(screen.getByTestId('snapshot-sidebar')).toBeInTheDocument());
    expect(screen.queryByTestId('snapshot-compact-controls')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拍快照' })).toBeInTheDocument();
  });
});
