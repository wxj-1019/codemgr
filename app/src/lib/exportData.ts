// 数据导出序列化（子项目 E，纯逻辑）：CSV/JSON 文本生成 + 导出文件名。
// 内容在渲染层序列化后整体传给 main（config:exportDataFile），渲染层不碰路径（红线）。
import type { ProcessInfo, NetConnection } from '../../electron/ipc-types';

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 首行表头，CRLF 行尾（Excel 兼容）。 */
export function rowsToCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function processesToCsv(procs: ProcessInfo[], cpuMap: Record<number, number>): string {
  return rowsToCsv(
    ['pid', 'ppid', 'name', 'cpu_percent', 'memory_bytes', 'threads', 'cmdline', 'cwd', 'create_time_iso'],
    procs.map((p) => [
      p.pid, p.ppid, p.name, (cpuMap[p.pid] ?? 0).toFixed(1), p.workingSetBytes,
      p.threadCount, p.cmdline, p.cwd, new Date(p.createTimeMs).toISOString(),
    ]),
  );
}

export function connectionsToCsv(conns: NetConnection[]): string {
  return rowsToCsv(
    ['protocol', 'local_addr', 'local_port', 'remote_addr', 'remote_port', 'state', 'pid', 'process_name'],
    conns.map((c) => [c.protocol, c.localAddr, c.localPort, c.remoteAddr, c.remotePort, c.state, c.pid, c.processName]),
  );
}

export function toPrettyJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** codemgr-<base>-YYYYMMDD-HHmm.<ext>（本地时间）。 */
export function buildExportName(base: string, ext: 'csv' | 'json', now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `codemgr-${base}-${stamp}.${ext}`;
}
