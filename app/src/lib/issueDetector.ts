import type { PerfData, ProcessInfo } from '../../electron/ipc-types';

export type IssueRule = 'system-cpu' | 'process-cpu' | 'memory-growth' | 'disk-low';
export type IssueSeverity = 'attention' | 'alert';

export interface Issue {
  id: string;            // `${rule}:${entity}`（entity=pid 或盘名）
  rule: IssueRule;
  severity: IssueSeverity;
  title: string;
  detail: string;
  processId?: number;
  action: 'locate-process' | 'open-perf';
  /** 仅 process-cpu 第 1 轮占位使用：不返回给调用方（return 前防御性过滤依据） */
  placeholder?: true;
}

export interface IssueSnapshot {
  cpuTotalPercent: number;
  processes: ProcessInfo[];
  /**
   * pid → cpuPercent（相对单核 0-100）。仓库 ProcessInfo 不含 cpuPercent，
   * 由调用方从 CpuUsage 通道合并进 cpuMap（对应 processPanelStore.cpuMap）。
   */
  cpuMap: Record<number, number>;
  procHistory: Record<number, { ts: number; cpu: number; mem: number }[]>;
  disks: PerfData['disks'];
}

const MAX_ISSUES = 10;
const SEVERITY_RANK: Record<IssueSeverity, number> = { attention: 0, alert: 1 };

export class IssueDetector {
  private cpuHighStreak = 0;
  /** 当前激活问题（含 process-cpu 的「第 1 轮占位」——用于连续轮判定与消除） */
  private active = new Map<string, Issue>();

  update(snap: IssueSnapshot): Issue[] {
    const next = new Map<string, Issue>();

    // 系统 CPU 持续高：>80% 连续 3 轮
    this.cpuHighStreak = snap.cpuTotalPercent > 80 ? this.cpuHighStreak + 1 : 0;
    if (this.cpuHighStreak >= 3) {
      next.set('system-cpu:all', {
        id: 'system-cpu:all', rule: 'system-cpu', severity: 'alert',
        title: '系统 CPU 持续高占用', detail: `连续 ${this.cpuHighStreak} 个采样周期超过 80%`, action: 'open-perf',
      });
    }

    // 单进程 CPU 异常：>=100（占满一核）连续 2 轮；第 1 轮以占位记入 active 供下轮判定
    for (const p of snap.processes) {
      const cpuPercent = snap.cpuMap[p.pid] ?? 0;
      if (cpuPercent >= 100) {
        const id = `process-cpu:${p.pid}`;
        if (this.active.has(id)) {
          next.set(id, {
            id, rule: 'process-cpu', severity: 'attention',
            title: `${p.name} 持续高占用 CPU`, detail: `CPU ${Math.round(cpuPercent)}%（占满 ${(cpuPercent / 100).toFixed(1)} 核）`,
            processId: p.pid, action: 'locate-process',
          });
        } else {
          next.set(id, { id, rule: 'process-cpu', severity: 'attention', title: '', detail: '', processId: p.pid, action: 'locate-process', placeholder: true });
        }
      }
    }

    // 内存增长：procHistory 末 3 样本递增且增幅 >15% 或 >200MB
    for (const [pidStr, points] of Object.entries(snap.procHistory)) {
      const pid = Number(pidStr);
      if (points.length < 3) continue;
      const last3 = points.slice(-3);
      const [a, b, c] = last3.map((x) => x.mem);
      // a=0 时百分比无意义（除零保护），此时依赖 >200MB 绝对增量分支仍可捕获信号
      const growth = a > 0 ? (c - a) / a : 0;
      if (a < b && b < c && (growth > 0.15 || c - a > 200 * 1024 * 1024)) {
        const proc = snap.processes.find((x) => x.pid === pid);
        const detail = a > 0
          ? `近 3 个采样周期增长 ${Math.round(growth * 100)}%（疑似泄漏）`
          : `近 3 个采样周期增长 ${Math.round((c - a) / (1024 * 1024))} MB（疑似泄漏）`;
        next.set(`memory-growth:${pid}`, {
          id: `memory-growth:${pid}`, rule: 'memory-growth', severity: 'attention',
          title: `${proc?.name ?? `PID ${pid}`} 内存持续增长`, detail,
          processId: pid, action: 'locate-process',
        });
      }
    }

    // 磁盘低：任一盘剩余 <=10%（与 healthAssess 阈值语义对齐）
    for (const d of snap.disks) {
      if (d.totalBytes > 0 && d.freeBytes / d.totalBytes <= 0.1) {
        const pct = Math.floor((d.freeBytes / d.totalBytes) * 100);
        next.set(`disk-low:${d.name}`, {
          id: `disk-low:${d.name}`, rule: 'disk-low', severity: 'alert',
          title: `${d.name} 磁盘空间不足`, detail: `剩余 ${pct}%`, action: 'open-perf',
        });
      }
    }

    // 本轮仍满足条件（含第 1 轮占位）→ 成为下轮的 active；条件消失的条目自然移除（消除）
    this.active = next;
    return [...next.values()]
      .filter((x) => !x.placeholder) // 占位不返回（防御：防未来重构泄漏空行）
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
      .slice(0, MAX_ISSUES);
  }
}
