import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockIpc } from './setup';
import { PortRadar } from '../src/components/PortRadar';
import { ToastHost } from '../src/components/ToastHost';
import { __resetToastStoreForTests } from '../src/store/toastStore';

vi.mock('../src/hooks/usePortRadar', () => ({ usePortRadar: vi.fn() }));
vi.mock('../src/components/PortTable', () => ({
  PortTable: ({ onKill, showAll }: { onKill?: (pid: number, name: string) => void; showAll?: boolean }) => (
    <div>
      <span data-testid="show-all-prop">{String(!!showAll)}</span>
      <button onClick={() => onKill?.(3000, 'node.exe')}>kill-row</button>
    </div>
  ),
}));

beforeEach(() => {
  __resetToastStoreForTests();
});

describe('PortRadar 单杀反馈（UX-03）', () => {
  it('kill 成功后显示成功反馈横幅', async () => {
    mockIpc({
      fetchConnections: vi.fn(() => Promise.resolve({
        ok: true as const,
        data: [{ protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 42, processName: 'node.exe' }],
        sampledAt: Date.now(),
      } as never)),
      killProcess: vi.fn(() => Promise.resolve('killed')),
    });
    render(<><ToastHost /><PortRadar /></>);
    fireEvent.click(screen.getByRole('button', { name: 'kill-row' }));
    fireEvent.click(screen.getByRole('button', { name: '结束进程' }));
    expect(await screen.findByText(/已结束 node\.exe（PID 3000）/)).toBeInTheDocument();
  });

  it('kill 失败（受保护）显示明确原因（UX-02 不再三合一）', async () => {
    mockIpc({
      fetchConnections: vi.fn(() => Promise.resolve({
        ok: true as const,
        data: [],
        sampledAt: Date.now(),
      } as never)),
      killProcess: vi.fn(() => Promise.resolve('protected')),
    });
    render(<><ToastHost /><PortRadar /></>);
    fireEvent.click(screen.getByRole('button', { name: 'kill-row' }));
    fireEvent.click(screen.getByRole('button', { name: '结束进程' }));
    expect(await screen.findByText(/受保护进程，无法结束/)).toBeInTheDocument();
  });
});

describe('PortRadar 仅监听/全部连接切换（UX-19）', () => {
  it('默认「仅监听」；点击切换到「全部连接」并透传给 PortTable', async () => {
    mockIpc({
      fetchConnections: vi.fn(() => Promise.resolve({
        ok: true as const,
        data: [],
        sampledAt: Date.now(),
      } as never)),
    });
    render(<><ToastHost /><PortRadar /></>);
    expect(screen.getByRole('button', { name: '仅监听' })).toBeInTheDocument();
    expect(screen.getByTestId('show-all-prop')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: '仅监听' }));
    expect(screen.getByRole('button', { name: '全部连接' })).toBeInTheDocument();
    expect(screen.getByTestId('show-all-prop')).toHaveTextContent('true');
  });
});
