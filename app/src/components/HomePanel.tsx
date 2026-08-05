import { useRef, useState } from 'react';
import { useHomeStore } from '../store/homeStore';
import { usePerfStore } from '../store/perfStore';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useLayoutStore } from '../store/layoutStore';
import { useContainerWidth } from '../hooks/useContainerWidth';
import { PanelActionBar } from './ui/PanelActionBar';
import { Badge, type BadgeTone } from './ui/Badge';
import { StateView } from './ui/StateView';
import { PanelAlert } from './ui/PanelAlert';
import { Button } from './ui/Button';
import { CleanupDialog } from './CleanupDialog';
import { CheckCircle2 } from './icons';
import { useHome } from '../hooks/useHome';
import { formatBytesPerSec } from '../lib/format';
import type { Issue } from '../lib/issueDetector';
import type { HealthLevel } from '../lib/healthAssess';

/** 评估分级 → 文案 + 徽章色（spec §3.1 ①）。 */
const LEVEL_META: Record<HealthLevel, { text: string; tone: BadgeTone }> = {
  excellent: { text: '优', tone: 'success' },
  good: { text: '良好', tone: 'success' },
  attention: { text: '需要关注', tone: 'warning' },
  alert: { text: '需要处理', tone: 'danger' },
};

/** 陈旧横幅阈值：上次成功采样距今超过 5s 即提示数据陈旧（perfStore.staleAt 由面板/自驱采样写入）。 */
const STALE_BANNER_MS = 5000;

type DotTone = 'normal' | 'warn' | 'danger';
/** 趋势箭头方向：末两点比较，持平不显示（null）。 */
type Trend = 'up' | 'down' | null;

/** 两点比较 → 趋势方向；prev===next 时返回 null（不显示）。 */
function trendOf(prev: number, next: number): Trend {
  if (next > prev) return 'up';
  if (next < prev) return 'down';
  return null;
}

const DOT_CLASS: Record<DotTone, string> = {
  normal: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/**
 * high 方向指标（CPU/内存/GPU）状态点色，阈值与 healthAssess 对齐（>=attentionAt → warn，
 * >=alertAt → danger）。CPU/内存传 70/85；GPU 传 80/90（healthAssess 的 gpu 阈值）。
 */
function metricTone(pct: number, attentionAt: number, alertAt: number): DotTone {
  if (pct >= alertAt) return 'danger';
  if (pct >= attentionAt) return 'warn';
  return 'normal';
}

/** low 方向指标（磁盘剩余）状态点色：>20 normal / 10-20 warn / <=10 danger */
function diskTone(pct: number): DotTone {
  if (pct <= 10) return 'danger';
  if (pct <= 20) return 'warn';
  return 'normal';
}

/** 联动：打开性能面板（状态卡点击 / open-perf 问题 / 快速动作共用）。 */
function openPerf() {
  useLayoutStore.getState().openPanel('perf');
}

/** 联动：打开进程面板并选中指定 pid（locate-process 问题 / 快速动作共用）。 */
function openProcess(pids: number[]) {
  useLayoutStore.getState().openPanel('process');
  useProcessPanelStore.getState().selectAll(pids);
}

/** 问题处理：locate-process → 进程面板 + 选中；open-perf → 性能面板。 */
function handleIssue(issue: Issue) {
  if (issue.action === 'locate-process' && issue.processId !== undefined) {
    openProcess([issue.processId]);
  } else {
    openPerf();
  }
}

interface StatCardProps {
  name: string;
  value: string;
  tone: DotTone;
  onClick?: () => void;
  /** 趋势箭头（CPU/内存）：up=↑(danger) / down=↓(success) / null 不显示。 */
  trend?: Trend;
}

/**
 * 状态卡。可点击的卡是真 button（键盘可达 + focus 语义）；无详情（磁盘）的卡
 * 渲染为 disabled button，视觉降不透明度且无 hover。
 */
function StatCard({ name, value, tone, onClick, trend }: StatCardProps) {
  const interactive = onClick !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={
        'rounded-lg border border-line bg-surface-panel/60 p-3 text-left transition-colors disabled:cursor-default disabled:opacity-60' +
        (interactive
          ? ' cursor-pointer hover:bg-surface-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas'
          : '')
      }
    >
      <div className="text-xs text-content-muted">{name}</div>
      <div className="mt-1 truncate text-lg font-semibold text-content-primary">{value}</div>
      {trend !== null && trend !== undefined && (
        <div className="mt-0.5 text-[11px] leading-none">
          <span className={trend === 'up' ? 'text-danger' : 'text-success'}>{trend === 'up' ? '↑' : '↓'}</span>
        </div>
      )}
      <span aria-hidden="true" className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]}`} />
    </button>
  );
}

/**
 * 首页仪表盘（spec §3.1 四区）：① 评估横幅 ② 五张状态卡 ③ 问题清单 ④ 快速动作。
 * 数据来自 homeStore（useHome 轮询驱动），联动 openPanel + selectAll 打开进程/性能面板。
 */
export function HomePanel() {
  useHome(); // 挂载即轮询（首帧 + 2s tick；可见性门控见 useHome）
  const assessment = useHomeStore((s) => s.assessment);
  const issues = useHomeStore((s) => s.issues);
  const error = useHomeStore((s) => s.error);
  const perf = usePerfStore((s) => s.current);
  const history = usePerfStore((s) => s.history);
  const staleAt = usePerfStore((s) => s.staleAt);
  // 「一键优化」对话框开关（CleanupDialog 挂组件根部，portal 渲染）
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // ref 挂到两个分支（loading/内容）都渲染的外层 div（同 ProcessPanel 模式）：
  // useContainerWidth 首帧测量 → loading 期挂载也能拿到宽度，grid-cols 不退化。
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);

  // 状态卡数据（perf 为 null 时值显示「—」）；磁盘取剩余百分比最小的盘（盘符 + 百分比）
  const disks = perf?.disks.filter((d) => d.totalBytes > 0) ?? [];
  const minDisk = disks.length
    ? disks.reduce((a, b) => ((a.freeBytes / a.totalBytes) <= (b.freeBytes / b.totalBytes) ? a : b))
    : null;
  const diskFreePct = minDisk !== null ? (minDisk.freeBytes / minDisk.totalBytes) * 100 : null;
  const netBytesPerSec = perf
    ? perf.networks.reduce((sum, n) => sum + n.recvBytesPerSec + n.sendBytesPerSec, 0)
    : null;
  const gpuPercent = perf?.gpu.available ? perf.gpu.totalPercent : null;
  // 趋势（末两点比较，history 不足 2 点不显示）：CPU/内存 值下方 ↑/↓
  const cpuTrend = history.length >= 2
    ? trendOf(history[history.length - 2].cpuTotal, history[history.length - 1].cpuTotal)
    : null;
  const memTrend = history.length >= 2
    ? trendOf(history[history.length - 2].memUsedPercent, history[history.length - 1].memUsedPercent)
    : null;
  // 陈旧提示：上次成功采样超过 STALE_BANNER_MS 未更新（staleAt 由 perf 面板/自驱采样写入）
  const stale = staleAt !== null && Date.now() - staleAt > STALE_BANNER_MS;
  const staleTimeText = stale && staleAt !== null
    ? new Date(staleAt).toLocaleTimeString('zh-CN', { hour12: false })
    : '';

  const cards: StatCardProps[] = [
    {
      name: 'CPU',
      value: perf ? `${Math.round(perf.cpu.totalPercent)}%` : '—',
      tone: perf ? metricTone(perf.cpu.totalPercent, 70, 85) : 'normal',
      onClick: openPerf,
      trend: cpuTrend,
    },
    {
      name: '内存',
      value: perf ? `${Math.round(perf.memory.usedPercent)}%` : '—',
      tone: perf ? metricTone(perf.memory.usedPercent, 70, 85) : 'normal',
      onClick: openPerf,
      trend: memTrend,
    },
    {
      name: '磁盘',
      value: minDisk !== null && diskFreePct !== null ? `${minDisk.name} 剩余 ${Math.round(diskFreePct)}%` : '—',
      tone: diskFreePct !== null ? diskTone(diskFreePct) : 'normal',
      // 磁盘卡无详情面板，不点击（disabled button）
    },
    {
      name: '网络',
      value: netBytesPerSec !== null ? formatBytesPerSec(netBytesPerSec) : '—',
      tone: 'normal',
      onClick: openPerf,
    },
    {
      name: 'GPU',
      value: gpuPercent !== null ? `${Math.round(gpuPercent)}%` : '—',
      tone: gpuPercent !== null ? metricTone(gpuPercent, 80, 90) : 'normal',
      onClick: openPerf,
    },
  ];

  // 快速动作数据（渲染期计算 → disabled 与点击用同一份）：cpuMap 降序前 3 / issues 去重 pid
  const topCpuPids = Object.entries(useProcessPanelStore.getState().cpuMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pid]) => Number(pid));
  const issuePids = [...new Set(
    issues.filter((i) => i.processId !== undefined).map((i) => i.processId as number),
  )];

  return (
    <>
      <div ref={ref} className="flex h-full flex-col">
        <PanelActionBar label="首页" summary={assessment === null ? '数据采集中…' : undefined} />
        {assessment === null ? (
          error !== null ? (
            // 失败态（优先级高于 loading）：自驱采样连续失败 → 错误视图 + 重试
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <StateView state="error" title="无法获取系统状态" description={error} />
              <Button variant="secondary" size="sm" onClick={() => void useHomeStore.getState().refresh()}>重试</Button>
            </div>
          ) : (
            <StateView state="loading" title="正在评估电脑状态…" />
          )
        ) : (
          <>
            {/* ① 评估横幅 */}
            <div className="flex items-center gap-2 border-b border-line bg-surface-panel/60 px-3 py-2">
              <Badge tone={LEVEL_META[assessment.level].tone}>{LEVEL_META[assessment.level].text}</Badge>
              <span title={reasonTextOf(assessment.reasons)} className="truncate text-xs text-content-secondary">
                {reasonTextOf(assessment.reasons)}
              </span>
            </div>
            {/* ② 状态卡：容器宽度 ≥960px 五卡一行，否则两卡换行；数据陈旧时顶部提示 */}
            {stale && (
              <PanelAlert tone="info">数据陈旧（{staleTimeText} 起）</PanelAlert>
            )}
            <div className={`grid gap-2 p-3 ${width !== null && width >= 960 ? 'grid-cols-5' : 'grid-cols-2'}`}>
              {cards.map((c) => <StatCard key={c.name} {...c} />)}
            </div>
            {/* ③ 问题清单 */}
            <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
              {issues.length === 0 ? (
                <div className="flex items-center justify-center gap-1.5 px-3 py-6 text-xs text-content-muted">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  各项指标正常
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {issues.map((issue) => (
                    <li
                      key={issue.id}
                      className="flex items-center gap-2 rounded-lg border border-line bg-surface-panel/60 px-3 py-2"
                    >
                      <Badge tone={issue.severity === 'alert' ? 'danger' : 'warning'}>
                        {issue.severity === 'alert' ? '严重' : '注意'}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-content-primary">{issue.title}</div>
                        <div className="truncate text-xs text-content-muted">{issue.detail}</div>
                      </div>
                      <Button size="xs" aria-label={`处理：${issue.title}`} onClick={() => handleIssue(issue)}>处理</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* ④ 快速动作（空选禁用：无数据时点了也无意义） */}
            <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
              <Button variant="primary" size="sm" onClick={() => setCleanupOpen(true)}>一键优化</Button>
              <Button size="sm" variant="secondary" disabled={topCpuPids.length === 0} onClick={() => openProcess(topCpuPids)}>查看高占用进程</Button>
              <Button size="sm" variant="secondary" disabled={issuePids.length === 0} onClick={() => openProcess(issuePids)}>结束异常进程</Button>
              <Button size="sm" variant="secondary" onClick={openPerf}>打开性能详情</Button>
            </div>
          </>
        )}
      </div>
      <CleanupDialog open={cleanupOpen} onOpenChange={setCleanupOpen} />
    </>
  );
}

/** 评估 reasons 拼接；无 reasons 时给「系统各项指标正常」占位。 */
function reasonTextOf(reasons: string[]): string {
  return reasons.length ? reasons.join('；') : '系统各项指标正常';
}
