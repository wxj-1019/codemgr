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
import { PollIntervalSelect } from './PollIntervalSelect';
import { formatBytesPerSec } from '../lib/format';

type SubTab = 'cpu' | 'memory' | 'disk' | 'network' | 'gpu';

interface PerfHistoryPoint {
  t: number;
  cpuTotal: number;
  memUsedPercent: number;
  gpuTotal: number;
}

function fmtBytes(b: number): string {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

export function PerfPanel() {
  usePerf();
  const { current, history, error, pollMs, setPollMs } = usePerfStore();
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
    { id: 'gpu', label: 'GPU' },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <h1 className="text-lg font-semibold text-fg-primary">性能</h1>
        <div className="flex items-center gap-3">
          <PollIntervalSelect value={pollMs} onChange={setPollMs} />
          <div className="flex gap-1">
            {subTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={`rounded px-3 py-1 text-sm ${
                  sub === t.id
                    ? 'bg-accent/20 text-accent'
                    : 'text-fg-secondary hover:text-fg-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        {sub === 'cpu' && <CpuView current={current} history={history} />}
        {sub === 'memory' && <MemoryView current={current} history={history} />}
        {sub === 'disk' && <DiskView current={current} />}
        {sub === 'network' && <NetworkView current={current} />}
        {sub === 'gpu' && <GpuView current={current} history={history} />}
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
          <span className="text-sm text-fg-secondary">CPU 使用率</span>
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
        <div className="mb-2 text-sm text-fg-secondary">
          各核心 ({current.cpu.perCore.length} 核)
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {current.cpu.perCore.map((c: number, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 text-xs text-fg-muted">Core {i}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-base-700">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, c)}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-xs text-fg-secondary">
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
          <span className="text-sm text-fg-secondary">内存使用</span>
          <span className="font-mono text-3xl font-bold text-accent">
            {mem.usedPercent.toFixed(0)}%
          </span>
        </div>
        <div className="mt-2 text-sm text-fg-muted">
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
      <div className="mb-3 text-sm text-fg-secondary">磁盘空间</div>
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
                <span className="font-mono text-fg-primary">{d.name}</span>
                <span className="text-fg-muted">
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
              <div className="mt-0.5 text-xs text-fg-muted">
                读 {formatBytesPerSec(d.readBytesPerSec)} · 写 {formatBytesPerSec(d.writeBytesPerSec)} · 活跃 {d.activePercent.toFixed(0)}%
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
      <div className="mb-3 text-sm text-fg-secondary">网络适配器（活跃）</div>
      {active.length === 0 ? (
        <div className="text-sm text-fg-muted">无活跃网络流量</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-fg-muted">
            <tr>
              <th className="py-1 text-left">适配器</th>
              <th className="py-1 text-right">↓ 接收</th>
              <th className="py-1 text-right">↑ 发送</th>
            </tr>
          </thead>
          <tbody>
            {active.map((n, i) => (
              <tr key={i} className="border-t border-base-700/30">
                <td className="py-1.5 font-mono text-fg-primary">{n.name}</td>
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

function GpuView({
  current,
  history,
}: {
  current: PerfData;
  history: PerfHistoryPoint[];
}) {
  const gpu = current.gpu;
  // 降级：无 GPU 计数器（虚拟机/远程桌面）
  if (!gpu.available) {
    return (
      <div className="rounded-lg border border-base-700 bg-base-800 p-8 text-center">
        <div className="text-sm text-fg-muted">此环境不支持 GPU 计数器（虚拟机/远程桌面/无 GPU）</div>
      </div>
    );
  }
  const vramPct = gpu.vramBudgetBytes > 0
    ? (gpu.vramUsedBytes / gpu.vramBudgetBytes) * 100
    : 0;
  const vramColor = vramPct > 90 ? 'bg-red-500' : vramPct > 70 ? 'bg-amber-500' : 'bg-accent';
  // perProcess Top 5 by gpuPercent
  const top5 = [...gpu.perProcess].sort((a, b) => b.gpuPercent - a.gpuPercent).slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-base-700 bg-base-800 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg-secondary">GPU 使用率</span>
          <span className="font-mono text-3xl font-bold text-accent">
            {gpu.totalPercent.toFixed(1)}%
          </span>
        </div>
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="gpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={false} />
              <YAxis domain={[0, 100]} width={30} tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1a2028', border: '1px solid #2f3947', borderRadius: 6 }}
                labelFormatter={() => ''}
                formatter={(v: number | string) => [Number(v).toFixed(1) + '%', 'GPU']}
              />
              <Area type="monotone" dataKey="gpuTotal" stroke="#60a5fa" strokeWidth={2} fill="url(#gpuGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-lg border border-base-700 bg-base-800 p-4">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-fg-secondary">显存</span>
          <span className="text-fg-muted">
            {fmtBytes(gpu.vramUsedBytes)}
            {gpu.vramBudgetBytes > 0 ? ' / ' + fmtBytes(gpu.vramBudgetBytes) : '（总量未知）'}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-base-700">
          <div className={`h-full ${vramColor}`} style={{ width: `${Math.min(100, vramPct)}%` }} />
        </div>
      </div>
      {top5.length > 0 && (
        <div className="rounded-lg border border-base-700 bg-base-800 p-4">
          <div className="mb-2 text-sm text-fg-secondary">GPU 占用 Top 5（数据来自性能面板轮询）</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-fg-muted">
              <tr>
                <th className="py-1 text-left">PID</th>
                <th className="py-1 text-right">GPU%</th>
                <th className="py-1 text-right">显存</th>
              </tr>
            </thead>
            <tbody>
              {top5.map((p) => (
                <tr key={p.pid} className="border-t border-base-700/30">
                  <td className="py-1.5 font-mono text-fg-primary">{p.pid}</td>
                  <td className="py-1.5 text-right font-mono text-accent">{p.gpuPercent.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-mono text-fg-secondary">{fmtBytes(p.vramBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* v2.x 多适配器明细（核显+独显分卡；仅 >1 时显示，单卡时上层总览已够） */}
      {gpu.adapters.length > 1 && (
        <div className="rounded-lg border border-base-700 bg-base-800 p-4">
          <div className="mb-3 text-sm text-fg-secondary">适配器明细</div>
          <div className="space-y-3">
            {gpu.adapters.map((a, i) => {
              const pct = a.vramBudgetBytes > 0 ? (a.vramUsedBytes / a.vramBudgetBytes) * 100 : 0;
              const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-accent';
              return (
                <div key={i}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-mono text-fg-primary">{a.name}</span>
                    <span className="text-fg-muted">
                      {a.totalPercent.toFixed(0)}% · {fmtBytes(a.vramUsedBytes)}
                      {a.vramBudgetBytes > 0 ? ' / ' + fmtBytes(a.vramBudgetBytes) : ''}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-base-700">
                    <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
