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

describe('PortTable keyboard navigation', () => {
  it('makes the first row the initial keyboard entry point', () => {
    const { container } = render(
      <PortTable
        connections={[conn({ pid: 100 }), conn({ pid: 200, localPort: 3001 })]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />,
    );
    const rows = container.querySelectorAll('tbody tr[role="row"]');
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
    expect(container.firstElementChild).toHaveClass('flex-1', 'min-h-0', 'overflow-auto');
  });

  it('ArrowDown moves focus to next row (roving tabindex)', () => {
    const { container } = render(
      <PortTable
        connections={[
          conn({ pid: 100, localPort: 3000 }),
          conn({ pid: 200, localPort: 3001 }),
          conn({ pid: 300, localPort: 3002 }),
        ]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />,
    );
    const getRows = () => container.querySelectorAll('tbody tr[role="row"]');
    fireEvent.keyDown(getRows()[0], { key: 'ArrowDown' });
    // 焦点移到第二行：tabIndex=0，且带 data-row-focused
    expect(getRows()[1]).toHaveAttribute('tabindex', '0');
    expect(getRows()[1]).toHaveAttribute('data-row-focused', 'true');
    expect(getRows()[0]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown then ArrowUp returns focus (pid-anchored navigation)', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PortTable
        connections={[
          conn({ pid: 100, localPort: 3000 }),
          conn({ pid: 200, localPort: 3001 }),
          conn({ pid: 300, localPort: 3002 }),
        ]}
        selectedPid={null}
        onSelect={onSelect}
        onKill={() => {}}
      />,
    );
    const getRows = () => container.querySelectorAll('tbody tr[role="row"]');
    // ArrowDown → 焦点到第二行
    fireEvent.keyDown(getRows()[0], { key: 'ArrowDown' });
    expect(getRows()[1]).toHaveAttribute('data-row-focused', 'true');
    // ArrowUp → 焦点回第一行
    fireEvent.keyDown(getRows()[1], { key: 'ArrowUp' });
    expect(getRows()[0]).toHaveAttribute('data-row-focused', 'true');
  });

  it('Enter triggers onSelect with the focused row pid', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PortTable
        connections={[conn({ pid: 200, localPort: 3001 })]}
        selectedPid={null}
        onSelect={onSelect}
        onKill={() => {}}
      />,
    );
    const row = container.querySelector('tbody tr[role="row"]')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(200);
  });

  it('Space also triggers onSelect', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PortTable
        connections={[conn({ pid: 200, localPort: 3001 })]}
        selectedPid={null}
        onSelect={onSelect}
        onKill={() => {}}
      />,
    );
    const row = container.querySelector('tbody tr[role="row"]')!;
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(200);
  });

  it('Home/End jump to first/last row', () => {
    const { container } = render(
      <PortTable
        connections={[
          conn({ pid: 100, localPort: 3000 }),
          conn({ pid: 200, localPort: 3001 }),
          conn({ pid: 300, localPort: 3002 }),
        ]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />,
    );
    const getRows = () => container.querySelectorAll('tbody tr[role="row"]');
    fireEvent.keyDown(getRows()[1], { key: 'Home' }); // 从中行按 Home
    expect(getRows()[0]).toHaveAttribute('data-row-focused', 'true');
    fireEvent.keyDown(getRows()[0], { key: 'End' });
    expect(getRows()[2]).toHaveAttribute('data-row-focused', 'true');
  });

  it('ArrowDown at last row does nothing (no wrap)', () => {
    const { container } = render(
      <PortTable
        connections={[
          conn({ pid: 100, localPort: 3000 }),
          conn({ pid: 200, localPort: 3001 }),
        ]}
        selectedPid={null}
        onSelect={() => {}}
        onKill={() => {}}
      />,
    );
    const getRows = () => container.querySelectorAll('tbody tr[role="row"]');
    fireEvent.keyDown(getRows()[1], { key: 'ArrowDown' }); // 末行按 ArrowDown
    // 仍在末行，焦点没回卷到首行（data-row-focused 初始为 null，都不带）
    expect(getRows()[1]).not.toHaveAttribute('data-row-focused', 'true');
    expect(getRows()[0]).not.toHaveAttribute('data-row-focused', 'true');
  });
});
