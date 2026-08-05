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

/** 各指标分级阈值；disk 为 low 方向（低于即坏），其余为 high 方向 */
const THRESHOLDS = {
  cpu: { attentionAt: 70, alertAt: 85 },
  mem: { attentionAt: 70, alertAt: 85 },
  disk: { attentionAt: 20, alertAt: 10 },   // low 方向
  gpu: { attentionAt: 80, alertAt: 90 },
} as const;

/** 非法输入（NaN/Infinity）钳制为 0 → normal，避免横幅渲染「NaN%」 */
const safe = (v: number): number => (Number.isFinite(v) ? v : 0);

/** 阈值方向：high=超过即坏（CPU/内存/GPU），low=低于即坏（磁盘剩余） */
function metricLevel(value: number, attentionAt: number, alertAt: number, dir: 'high' | 'low'): MetricLevel {
  const bad = (v: number, t: number) => (dir === 'high' ? v >= t : v <= t);
  if (bad(value, alertAt)) return 'alert';
  if (bad(value, attentionAt)) return 'attention';
  return 'normal';
}

export function assessHealth(input: HealthInput): HealthAssessment {
  // 先取整后比较：显示值与判定基于同一数值（如 84.6% → 85% → alert，避免显示 85% 却判 attention）
  const cpu = Math.round(safe(input.cpuPercent));
  const mem = Math.round(safe(input.memPercent));
  const disk = Math.round(safe(input.diskFreeMinPercent));
  const metrics: { label: string; level: MetricLevel }[] = [
    { label: `CPU 使用率 ${cpu}%`, level: metricLevel(cpu, THRESHOLDS.cpu.attentionAt, THRESHOLDS.cpu.alertAt, 'high') },
    { label: `内存使用率 ${mem}%`, level: metricLevel(mem, THRESHOLDS.mem.attentionAt, THRESHOLDS.mem.alertAt, 'high') },
    { label: `磁盘剩余 ${disk}%`, level: metricLevel(disk, THRESHOLDS.disk.attentionAt, THRESHOLDS.disk.alertAt, 'low') },
  ];
  if (input.gpuPercent !== null) {
    const gpu = Math.round(safe(input.gpuPercent));
    metrics.push({ label: `GPU 使用率 ${gpu}%`, level: metricLevel(gpu, THRESHOLDS.gpu.attentionAt, THRESHOLDS.gpu.alertAt, 'high') });
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
