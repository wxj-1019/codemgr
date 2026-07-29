import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetConnection } from '../../electron/ipc-types';
import { labelForPort, isDevPort, isDbPort } from '../lib/portLabels';
import { isListenLike, conflictPorts } from '../lib/portFilter';

interface PortTableProps {
  connections: NetConnection[];
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
}

export function PortTable({ connections, selectedPid, onSelect, onKill }: PortTableProps) {
  const rows = connections.filter(isListenLike);
  const conflicts = useMemo(() => conflictPorts(connections), [connections]);

  // ── 键盘导航（纯导航模型：焦点框与 selectedPid 分离）──
  // 端口表同一 pid 可能在多行（多端口监听），焦点用 index 锚定更准确。
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const tableRef = useRef<HTMLTableElement | null>(null);

  // 焦点行变化时自动 focus + scrollIntoView（roving tabindex 配套）。
  // jsdom 无 scrollIntoView 实现，加 typeof 防御（真实 Electron 环境有该方法）。
  useEffect(() => {
    const el = tableRef.current?.querySelector<HTMLTableRowElement>('[data-row-focused="true"]');
    el?.focus();
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  function onRowKeyDown(e: React.KeyboardEvent, idx: number) {
    const cur = rowsRef.current;
    if (cur.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < cur.length - 1) setFocusedIdx(idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) setFocusedIdx(idx - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(cur[idx].pid);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusedIdx(cur.length - 1);
    }
  }

  return (
    <div className="overflow-auto">
      <table ref={tableRef} role="grid" className="w-full text-sm">
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
            const focused = i === focusedIdx;
            const conflict = conflicts.has(`${c.protocol}:${c.localPort}`);
            return (
              <tr
                key={`${c.pid}-${c.localPort}-${i}`}
                role="row"
                tabIndex={focused ? 0 : -1}
                data-row-focused={focused ? 'true' : undefined}
                aria-selected={selected}
                onClick={() => onSelect(c.pid)}
                onKeyDown={(e) => onRowKeyDown(e, i)}
                className={`cursor-pointer border-b border-base-700/50 hover:bg-base-700/40 ${
                  selected ? 'bg-base-700/60' : ''
                } ${focused ? 'ring-1 ring-inset ring-accent/60 outline-none' : ''}`}
              >
                <td
                  className={`px-3 py-2 font-mono ${
                    conflict ? 'text-red-400' : 'text-accent'
                  }`}
                  title={conflict ? '端口冲突：多个进程监听同一端口' : undefined}
                >
                  {conflict && <span aria-label="端口冲突">⚠ </span>}
                  {c.localPort}
                </td>
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
