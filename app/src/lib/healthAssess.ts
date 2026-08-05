export type HealthLevel = 'excellent' | 'good' | 'attention' | 'alert';

export interface HealthInput {
  cpuPercent: number;        // 系统 CPU 近期均值 0-100
  memPercent: number;        // 内存使用率 0-100
  diskFreeMinPercent: number;// 最小剩余盘百分比 0-100
  gpuPercent: number | null; // 有 GPU 时 0-100；无 GPU null（不参与）
  issueCount: number;        // 检测引擎当前问题数
}

export interface HealthAssessment {
  level: HealthLevel;
  /** 触达最差级的所有指标人话描述；excellent 时为空 */
  reasons: string[];
}

type MetricLevel = 'normal' | 'attention' | 'alert';

/** 阈值方向：high=超过即坏（CPU/内存/GPU），low=低于即坏（磁盘剩余） */
function metricLevel(value: number, attentionAt: number, alertAt: number, dir: 'high' | 'low'): MetricLevel {
  const bad = (v: number, t: number) => (dir === 'high' ? v >= t : v <= t);
  if (bad(value, alertAt)) return 'alert';
  if (bad(value, attentionAt)) return 'attention';
  return 'normal';
}

export function assessHealth(input: HealthInput): HealthAssessment {
  const metrics: { label: string; level: MetricLevel }[] = [
    { label: `CPU 使用率 ${Math.round(input.cpuPercent)}%`, level: metricLevel(input.cpuPercent, 70, 85, 'high') },
    { label: `内存使用率 ${Math.round(input.memPercent)}%`, level: metricLevel(input.memPercent, 70, 85, 'high') },
    { label: `磁盘剩余 ${Math.round(input.diskFreeMinPercent)}%`, level: metricLevel(input.diskFreeMinPercent, 20, 10, 'low') },
  ];
  if (input.gpuPercent !== null) {
    metrics.push({ label: `GPU 使用率 ${Math.round(input.gpuPercent)}%`, level: metricLevel(input.gpuPercent, 80, 90, 'high') });
  }

  const worst: MetricLevel = metrics.some((m) => m.level === 'alert') ? 'alert'
    : metrics.some((m) => m.level === 'attention') ? 'attention' : 'normal';
  // weakest link + 问题数修正（不越过 alert）
  let level: HealthLevel = worst === 'alert' ? 'alert' : worst === 'attention' ? 'good' : 'excellent';
  if (input.issueCount >= 2 && level === 'good') level = 'attention';

  const reasons = worst === 'normal'
    ? []
    : metrics.filter((m) => m.level === (worst === 'alert' ? 'alert' : 'attention')).map((m) => m.label);
  return { level, reasons };
}
