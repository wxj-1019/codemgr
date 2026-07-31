import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockIpc } from './setup';
import { PortRadar } from '../src/components/PortRadar';

vi.mock('../src/hooks/usePortRadar', () => ({ usePortRadar: vi.fn() }));
vi.mock('../src/components/PortTable', () => ({
  PortTable: ({ onKill }: { onKill?: (pid: number, name: string) => void }) => (
    <div>
      <button onClick={() => onKill?.(3000, 'node.exe')}>kill-row</button>
    </div>
  ),
}));

describe('PortRadar 单杀反馈（UX-03）', () => {
  it('kill 成功后显示成功反馈横幅', async () => {
    mockIpc({
      fetchConnections: vi.fn(() => Promise.resolve({
        ok: true as const,
        data: [{ protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000, remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 42, processName: 'node.exe' }],
        sampledAt: Date.now(),
      } as never)),
      killProcess: vi.fn(() => Promise.resolve(true)),
    });
    render(<PortRadar />);
    fireEvent.click(screen.getByRole('button', { name: 'kill-row' }));
    fireEvent.click(screen.getByRole('button', { name: '结束进程' }));
    expect(await screen.findByText(/已结束 node\.exe（PID 3000）/)).toBeInTheDocument();
  });

  it('kill 失败（返 false）显示失败反馈', async () => {
    mockIpc({
      fetchConnections: vi.fn(() => Promise.resolve({
        ok: true as const,
        data: [],
        sampledAt: Date.now(),
      } as never)),
      killProcess: vi.fn(() => Promise.resolve(false)),
    });
    render(<PortRadar />);
    fireEvent.click(screen.getByRole('button', { name: 'kill-row' }));
    fireEvent.click(screen.getByRole('button', { name: '结束进程' }));
    expect(await screen.findByText(/结束 node\.exe \(PID 3000\) 失败：受保护进程/)).toBeInTheDocument();
  });
});
