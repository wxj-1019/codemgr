import type { NetConnection } from '../../electron/ipc-types';
import { labelForPort, isDevPort, isDbPort } from '../lib/portLabels';
import { isListenLike } from '../lib/portFilter';

interface PortTableProps {
  connections: NetConnection[];
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
}

export function PortTable({ connections, selectedPid, onSelect, onKill }: PortTableProps) {
  const rows = connections.filter(isListenLike);

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-base-800 text-left text-xs uppercase text-fg-muted">
          <tr>
            <th className="px-3 py-2 font-medium">端口</th>
            <th className="px-3 py-2 font-medium">协议</th>
            <th className="px-3 py-2 font-medium">进程</th>
            <th className="px-3 py-2 font-medium">PID</th>
            <th className="px-3 py-2 font-medium">地址</th>
            <th className="px-3 py-2 font-medium">标签</th>
            <th className="px-3 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const label = labelForPort(c.localPort);
            const selected = c.pid === selectedPid;
            return (
              <tr
                key={`${c.pid}-${c.localPort}-${i}`}
                onClick={() => onSelect(c.pid)}
                className={`cursor-pointer border-b border-base-700/50 hover:bg-base-700/40 ${
                  selected ? 'bg-base-700/60' : ''
                }`}
              >
                <td className="px-3 py-2 font-mono text-accent">{c.localPort}</td>
                <td className="px-3 py-2 uppercase text-fg-secondary">{c.protocol}</td>
                <td className="px-3 py-2 text-fg-primary">{c.processName || '—'}</td>
                <td className="px-3 py-2 font-mono text-fg-secondary">{c.pid}</td>
                <td className="px-3 py-2 font-mono text-fg-muted">{c.localAddr}</td>
                <td className="px-3 py-2">
                  {label && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        isDevPort(c.localPort)
                          ? 'bg-accent/20 text-accent'
                          : isDbPort(c.localPort)
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-600/30 text-fg-secondary'
                      }`}
                    >
                      {label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onKill(c.pid, c.processName || `PID ${c.pid}`); }}
                    className="rounded bg-red-600/80 px-2 py-1 text-xs text-white hover:bg-red-500"
                  >
                    结束
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-fg-muted">暂无监听端口</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
