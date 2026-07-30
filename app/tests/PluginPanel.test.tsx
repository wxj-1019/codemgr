import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginPanel } from '../src/components/PluginPanel';
import { usePluginRegistryStore } from '../src/store/pluginRegistryStore';

describe('PluginPanel', () => {
  beforeEach(() => {
    usePluginRegistryStore.setState({ entries: [], loaded: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      usePluginRegistryStore.setState({ entries: [], loaded: false });
    });
  });

  it('keeps Hook order stable when the registry loads a previously missing entry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<PluginPanel id="plugin:disk-volumes" />);

    expect(screen.getByText(/未在 manifest 中登记/)).toBeInTheDocument();

    expect(() => {
      act(() => {
        usePluginRegistryStore.getState().setEntries([{
          id: 'disk-volumes',
          name: '磁盘卷',
          src: 'plugins/disk-volumes.html',
        }]);
      });
    }).not.toThrow();

    const iframe = screen.getByTitle('磁盘卷');
    expect(iframe).toHaveAttribute('src', 'plugins/disk-volumes.html');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/change in the order of Hooks|Rendered more hooks/);
  });
});
