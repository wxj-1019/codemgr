import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PortTable } from '../src/components/PortTable';
import type { NetConnection } from '../electron/ipc-types';

// PortTable receives connections via props (the parent PortRadar reads the store
// and passes them down), so tests pass connections directly rather than seeding
// the store.
const conn = (over: Partial<NetConnection> = {}): NetConnection => ({
  protocol: 'tcp',
  localAddr: '0.0.0.0',
  localPort: 3000,
  remoteAddr: '*',
  remotePort: 0,
  state: 'LISTENING',
  pid: 1234,
  processName: 'node',
  ...over,
});

describe('PortTable', () => {
  it('shows only listening ports (filters out non-listening TCP)', () => {
    render(
      <PortTable
        connections={[
          conn({ localPort: 3000, state: 'LISTENING', processName: 'node' }),
          conn({ localPort: 5173, state: 'ESTABLISHED', processName: 'other' }),
          conn({ protocol: 'udp', localPort: 5353, processName: 'mdns' }),
        ]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />
    );
    // 3000 (LISTENING) + 5353 (udp) shown; 5173 (ESTABLISHED) filtered
    expect(screen.getByText('3000')).toBeInTheDocument();
    expect(screen.getByText('5353')).toBeInTheDocument();
    expect(screen.queryByText('5173')).not.toBeInTheDocument();
  });

  it('renders dev server label badge for port 3000', () => {
    render(
      <PortTable
        connections={[conn({ localPort: 3000 })]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />
    );
    expect(screen.getByText('dev server')).toBeInTheDocument();
  });

  it('shows empty state when no connections', () => {
    render(
      <PortTable
        connections={[]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />
    );
    expect(screen.getByText('暂无监听端口')).toBeInTheDocument();
  });

  it('calls onKill with pid and name when kill button clicked', () => {
    const onKill = vi.fn();
    render(
      <PortTable
        connections={[conn({ pid: 42, processName: 'target.exe' })]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={onKill}
      />
    );
    fireEvent.click(screen.getByText('结束'));
    expect(onKill).toHaveBeenCalledWith(42, 'target.exe');
  });
});
