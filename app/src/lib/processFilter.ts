import type { ProcessInfo } from '../../electron/ipc-types';

/** 进程搜索过滤（名称/命令行/PID 子串，大小写不敏感）。ProcessTable 与导出入口共用。 */
export function filterProcesses(processes: ProcessInfo[], filter: string): ProcessInfo[] {
  if (!filter.trim()) return processes;
  const q = filter.toLowerCase();
  return processes.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.cmdline.toLowerCase().includes(q) ||
      String(p.pid).includes(q),
  );
}
