import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetConnection } from '../../electron/ipc-types';
import { labelForPort, isDevPort, isDbPort } from '../lib/portLabels';
import { TriangleAlert } from './icons';
import { isListenLike, conflictPorts, conflictHolders } from '../lib/portFilter';

interface PortTableProps {
  connections: NetConnection[];
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  onKill: (pid: number, name: string) => void;
  /** UX-19：true 时显示全部连接（含 ESTABLISHED 等非监听态），默认仅监听。 */
  showAll?: boolean;
}

export function PortTable({ connections, selectedPid, onSelect, onKill, showAll = false }: PortTableProps) {
  const rows = showAll ? connections : connections.filter(isListenLike);
  const conflicts = useMemo(() => conflictPorts(connections), [connections]);
  // UX-20：冲突端口 → 持有者 PID 列表（tooltip 指明"冲突对方是谁"）
  const holders = useMemo(() => conflictHolders(connections), [connections]);

  // ── 键盘导航（纯导航模型：焦点框与 selectedPid 分离）──
  // 端口表同一 pid 可能在多行（多端口监听），焦点用 index 锚定更准确。
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const tableRef = useRef<HTMLTableElement | null>(null);

  // UX-25：数据变化（过滤/轮询）后焦点索引可能越界——收敛到合法范围，
  // 避免焦点环凭空消失、键盘入口退到第一行。
  useEffect(() => {
    setFocusedIdx((cur) => {
      if (cur === null) return null;
      if (cur >= rows.length) return Math.max(0, rows.length - 1);
      return cur;
    });
  }, [rows.length]);

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
    <div className="min-h-0 flex-1 overflow-auto">
      <table ref={tableRef} role="grid" className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-panel text-left text-xs uppercase text-content-muted">
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
                tabIndex={focused || (focusedIdx === null && i === 0) ? 0 : -1}
                data-row-focused={focused ? 'true' : undefined}
                aria-selected={selected}
                onClick={() => onSelect(c.pid)}
                onKeyDown={(e) => onRowKeyDown(e, i)}
                className={`cursor-pointer border-b border-line hover:bg-surface-raised transition-colors duration-150 ease-out ${
                  selected ? 'bg-surface-raised/60' : ''
                } ${focused ? 'ring-1 ring-inset ring-focus/60 outline-none' : ''}`}
              >
                <td
                  className={`px-3 py-2 font-mono ${
                    conflict ? 'text-danger' : 'text-accent'
                  }`}
                  title={
                    conflict
                      ? (() => {
                          const others = (holders.get(`${c.protocol}:${c.localPort}`) ?? [])
                            .filter((pid) => pid !== c.pid);
                          return others.length > 0
                            ? `端口冲突：也正被 PID ${others.join(', ')} 监听`
                            : '端口冲突：多个进程监听同一端口';
                        })()
                      : undefined
                  }
                >
                  {conflict && <TriangleAlert size={13} className="mr-1 inline-block align-[-2px]" aria-label="端口冲突" />}
                  {c.localPort}
                </td>
                <td className="px-3 py-2 uppercase text-content-secondary">{c.protocol}</td>
                <td className="px-3 py-2 text-content-primary">{c.processName || '—'}</td>
                <td className="px-3 py-2 font-mono text-content-secondary">{c.pid}</td>
                <td className="px-3 py-2 font-mono text-content-muted">{c.localAddr}</td>
                <td className="px-3 py-2">
                  {label && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        isDevPort(c.localPort)
                          ? 'bg-accent/[0.14] text-accent'
                          : isDbPort(c.localPort)
                          ? 'bg-amber-500/[0.14] text-amber-400'
                          : 'bg-slate-600/[0.14] text-content-secondary'
                      }`}
                    >
                      {label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onKill(c.pid, c.processName || `PID ${c.pid}`); }}
                    className="btn-danger-quiet rounded-lg px-2 py-1 text-xs"
                  >
                    结束
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-content-muted">暂无监听端口</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
