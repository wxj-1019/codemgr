import { useRef } from 'react';
import { useHomeStore } from '../store/homeStore';
import { usePerfStore } from '../store/perfStore';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useLayoutStore } from '../store/layoutStore';
import { useContainerWidth } from '../hooks/useContainerWidth';
import { PanelActionBar } from './ui/PanelActionBar';
import { Badge, type BadgeTone } from './ui/Badge';
import { StateView } from './ui/StateView';
import { Button } from './ui/Button';
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

type DotTone = 'normal' | 'warn' | 'danger';

const DOT_CLASS: Record<DotTone, string> = {
  normal: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/** high 方向指标（CPU/内存/GPU）状态点色：<70 normal / 70-85 warn / >85 danger */
function metricTone(pct: number): DotTone {
  if (pct > 85) return 'danger';
  if (pct >= 70) return 'warn';
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
}

function StatCard({ name, value, tone, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={
        'rounded-lg border border-line bg-surface-panel/60 p-3' +
        (onClick ? ' cursor-pointer transition-colors hover:bg-surface-panel' : '')
      }
    >
      <div className="text-xs text-content-muted">{name}</div>
      <div className="mt-1 truncate text-lg font-semibold text-content-primary">{value}</div>
      <span className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]}`} />
    </div>
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
  const perf = usePerfStore((s) => s.current);
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);

  if (assessment === null) {
    return (
      <div className="flex h-full flex-col">
        <PanelActionBar label="首页" summary="数据采集中…" />
        <StateView state="loading" title="正在评估电脑状态…" />
      </div>
    );
  }

  const level = LEVEL_META[assessment.level];
  const reasonText = assessment.reasons.length ? assessment.reasons.join('；') : '系统各项指标正常';

  // ② 状态卡数据（perf 为 null 时值显示「—」，见 StatCard 取值）
  const disks = perf?.disks.filter((d) => d.totalBytes > 0) ?? [];
  const diskFreePct = disks.length
    ? Math.min(...disks.map((d) => (d.freeBytes / d.totalBytes) * 100))
    : null;
  const netBytesPerSec = perf
    ? perf.networks.reduce((sum, n) => sum + n.recvBytesPerSec + n.sendBytesPerSec, 0)
    : null;
  const gpuPercent = perf?.gpu.available ? perf.gpu.totalPercent : null;

  const cards: StatCardProps[] = [
    {
      name: 'CPU',
      value: perf ? `${Math.round(perf.cpu.totalPercent)}%` : '—',
      tone: perf ? metricTone(perf.cpu.totalPercent) : 'normal',
      onClick: openPerf,
    },
    {
      name: '内存',
      value: perf ? `${Math.round(perf.memory.usedPercent)}%` : '—',
      tone: perf ? metricTone(perf.memory.usedPercent) : 'normal',
      onClick: openPerf,
    },
    {
      name: '磁盘',
      value: diskFreePct !== null ? `剩余 ${Math.round(diskFreePct)}%` : '—',
      tone: diskFreePct !== null ? diskTone(diskFreePct) : 'normal',
      // 磁盘卡无详情面板，不点击
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
      tone: gpuPercent !== null ? metricTone(gpuPercent) : 'normal',
      onClick: openPerf,
    },
  ];

  // ④ 快速动作 1：cpuMap 降序前 3 的 pid（点击时取最新）
  const openTopCpuProcesses = () => {
    const pids = Object.entries(useProcessPanelStore.getState().cpuMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([pid]) => Number(pid));
    openProcess(pids);
  };
  // ④ 快速动作 2：issues 中 processId 去重列表（点击时取最新）
  const openIssueProcesses = () => {
    const pids = [...new Set(
      useHomeStore.getState().issues
        .filter((i) => i.processId !== undefined)
        .map((i) => i.processId as number),
    )];
    openProcess(pids);
  };

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar label="首页" />
      {/* ① 评估横幅 */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-panel/60 px-3 py-2">
        <Badge tone={level.tone}>{level.text}</Badge>
        <span className="truncate text-xs text-content-secondary">{reasonText}</span>
      </div>
      {/* ② 状态卡：容器宽度 ≥960px 五卡一行，否则两卡换行 */}
      <div
        ref={ref}
        className={`grid gap-2 p-3 ${width !== null && width >= 960 ? 'grid-cols-5' : 'grid-cols-2'}`}
      >
        {cards.map((c) => <StatCard key={c.name} {...c} />)}
      </div>
      {/* ③ 问题清单 */}
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
        {issues.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-content-muted">暂无异常</div>
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
                <Button size="xs" onClick={() => handleIssue(issue)}>处理</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* ④ 快速动作 */}
      <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
        <Button size="sm" variant="secondary" onClick={openTopCpuProcesses}>查看高占用进程</Button>
        <Button size="sm" variant="secondary" onClick={openIssueProcesses}>结束异常进程</Button>
        <Button size="sm" variant="secondary" onClick={openPerf}>打开性能详情</Button>
      </div>
    </div>
  );
}
