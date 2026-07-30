// 分组视图排序（子项目 H3，纯逻辑）：组级 name/memory；组内 name/cpu/memory/pid。稳定排序。
import type { ProjectGroup } from './projectGroup';
import type { ProcessInfo } from '../../electron/ipc-types';

export type GroupSortKey = 'name' | 'cpu' | 'memory' | 'pid';
export type SortDir = 'asc' | 'desc';

function byDir<T>(dir: SortDir, cmp: (a: T, b: T) => number) {
  return (a: T, b: T) => (dir === 'asc' ? cmp(a, b) : -cmp(a, b));
}

/** 组级排序：cpu/pid 对组无意义 → 原序返回。 */
export function sortGroups(groups: ProjectGroup[], key: GroupSortKey, dir: SortDir): ProjectGroup[] {
  if (key === 'name') return [...groups].sort(byDir(dir, (a, b) => a.name.localeCompare(b.name)));
  if (key === 'memory') return [...groups].sort(byDir(dir, (a, b) => a.totalMemory - b.totalMemory));
  return groups;
}

export function sortGroupProcs(
  procs: ProcessInfo[], key: GroupSortKey, dir: SortDir, cpuMap: Record<number, number>,
): ProcessInfo[] {
  const cmp = {
    name: (a: ProcessInfo, b: ProcessInfo) => a.name.localeCompare(b.name),
    cpu: (a: ProcessInfo, b: ProcessInfo) => (cpuMap[a.pid] ?? 0) - (cpuMap[b.pid] ?? 0),
    memory: (a: ProcessInfo, b: ProcessInfo) => a.workingSetBytes - b.workingSetBytes,
    pid: (a: ProcessInfo, b: ProcessInfo) => a.pid - b.pid,
  }[key];
  return [...procs].sort(byDir(dir, cmp));
}
