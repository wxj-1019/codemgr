import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { usePerf } from '../hooks/usePerf';
import { usePerfStore } from '../store/perfStore';
import type { PerfData } from '../../electron/ipc-types';
import { LoadState } from './LoadState';

type SubTab = 'cpu' | 'memory' | 'disk' | 'network';

interface PerfHistoryPoint {
  t: number;
  cpuTotal: number;
  memUsedPercent: number;
}

function fmtBytes(b: number): string {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

export function PerfPanel() {
  usePerf();
  const { current, history, error } = usePerfStore();
  const [sub, setSub] = useState<SubTab>('cpu');

  if (!current) {
    return (
      <LoadState
        loading={!error}
        error={error}
        empty={false}
        isFirstLoad
      />
    );
  }

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'cpu', label: 'CPU' },
    { id: 'memory', label: '内存' },
    { id: 'disk', label: '磁盘' },
    { id: 'network', label: '网络' },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-100">性能</h1>
        <div className="flex gap-1">
          {subTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={`rounded px-3 py-1 text-sm ${
                sub === t.id
                  ? 'bg-accent/20 text-accent'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        {sub === 'cpu' && <CpuView current={current} history={history} />}
        {sub === 'memory' && <MemoryView current={current} history={history} />}
        {sub === 'disk' && <DiskView current={current} />}
        {sub === 'network' && <NetworkView current={current} />}
      </main>
    </div>
  );
}

function CpuView({
  current,
  history,
}: {
  current: PerfData;
  history: PerfHistoryPoint[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-base-700 bg-base-800 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">CPU 使用率</span>
          <span className="font-mono text-3xl font-bold text-accent">
            {current.cpu.totalPercent.toFixed(1)}%
          </span>
        </div>
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={false} />
              <YAxis
                domain={[0, 100]}
                width={30}
                tick={{ fill: '#64748b', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a2028',
                  border: '1px solid #2f3947',
                  borderRadius: 6,
                }}
                labelFormatter={() => ''}
                formatter={(v: number | string) => [
                  Number(v).toFixed(1) + '%',
                  'CPU',
                ]}
              />
              <Area
                type="monotone"
                dataKey="cpuTotal"
                stroke="#2dd4bf"
                strokeWidth={2}
                fill="url(#cpuGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-lg border border-base-700 bg-base-800 p-4">
        <div className="mb-2 text-sm text-slate-400">
          各核心 ({current.cpu.perCore.length} 核)
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {current.cpu.perCore.map((c: number, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 text-xs text-slate-500">Core {i}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-base-700">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, c)}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-xs text-slate-400">
                {c.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MemoryView({
  current,
  history,
}: {
  current: PerfData;
  history: PerfHistoryPoint[];
}) {
  const mem = current.memory;
  const usedBytes = mem.totalBytes - mem.availableBytes;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-base-700 bg-base-800 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">内存使用</span>
          <span className="font-mono text-3xl font-bold text-accent">
            {mem.usedPercent.toFixed(0)}%
          </span>
        </div>
        <div className="mt-2 text-sm text-slate-500">
          {fmtBytes(usedBytes)} / {fmtBytes(mem.totalBytes)}
        </div>
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={false} />
              <YAxis
                domain={[0, 100]}
                width={30}
                tick={{ fill: '#64748b', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a2028',
                  border: '1px solid #2f3947',
                  borderRadius: 6,
                }}
                labelFormatter={() => ''}
                formatter={(v: number | string) => [
                  Number(v).toFixed(0) + '%',
                  '内存',
                ]}
              />
              <Area
                type="monotone"
                dataKey="memUsedPercent"
                stroke="#a78bfa"
                strokeWidth={2}
                fill="url(#memGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function DiskView({ current }: { current: PerfData }) {
  return (
    <div className="rounded-lg border border-base-700 bg-base-800 p-4">
      <div className="mb-3 text-sm text-slate-400">磁盘空间</div>
      <div className="space-y-3">
        {current.disks.map((d, i) => {
          const usedPct =
            d.totalBytes > 0
              ? (d.totalBytes - d.freeBytes) / d.totalBytes * 100
              : 0;
          const color =
            usedPct > 90
              ? 'bg-red-500'
              : usedPct > 70
                ? 'bg-amber-500'
                : 'bg-accent';
          return (
            <div key={i}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-mono text-slate-300">{d.name}</span>
                <span className="text-slate-500">
                  {fmtBytes(d.totalBytes - d.freeBytes)} /{' '}
                  {fmtBytes(d.totalBytes)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-base-700">
                <div
                  className={`h-full ${color}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NetworkView({ current }: { current: PerfData }) {
  const active = current.networks.filter(
    (n) => n.recvBytesPerSec > 0 || n.sendBytesPerSec > 0,
  );
  return (
    <div className="rounded-lg border border-base-700 bg-base-800 p-4">
      <div className="mb-3 text-sm text-slate-400">网络适配器（活跃）</div>
      {active.length === 0 ? (
        <div className="text-sm text-slate-500">无活跃网络流量</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 text-left">适配器</th>
              <th className="py-1 text-right">↓ 接收</th>
              <th className="py-1 text-right">↑ 发送</th>
            </tr>
          </thead>
          <tbody>
            {active.map((n, i) => (
              <tr key={i} className="border-t border-base-700/30">
                <td className="py-1.5 font-mono text-slate-300">{n.name}</td>
                <td className="py-1.5 text-right font-mono text-accent">
                  {fmtBytes(n.recvBytesPerSec)}/s
                </td>
                <td className="py-1.5 text-right font-mono text-amber-400">
                  {fmtBytes(n.sendBytesPerSec)}/s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
