import type { ProcessInfo } from '../../electron/ipc-types';

export interface ProjectGroup {
  name: string;
  dir: string | null;
  pids: number[];
  totalMemory: number;  // sum of workingSetBytes
}

// Normalize a Windows path to a comparable form (uppercase drive, forward slashes).
// 同时剥离 NT 命名空间前缀（\??\ 和 \\?\）——精确 cwd（PEB 直读）偶尔带这类前缀，
// 不剥则与启发式 cwd 形成不同分组键。native 侧已主要处理，此处二次保险。
function normPath(p: string): string {
  return p
    .replace(/^(?:\\\?\?\\|\\\\\?\\)/i, '')   // \??\ 或 \\?\ 前缀
    .replace(/\\/g, '/')
    .replace(/^[a-z]:/, (m) => m.toUpperCase())
    .replace(/\/$/, '');
}

// Last path segment, or null.
function lastSegment(p: string): string | null {
  const n = normPath(p);
  const parts = n.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * 从规范化路径取倒数 n 段拼接（n=1 等价 basename，n=2 = parent/basename …）。
 * 段不足时返回完整规范化路径。用于同名组逐级消歧显示名。
 */
function lastSegments(p: string, n: number): string {
  const norm = normPath(p);
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= n) return norm;
  return parts.slice(parts.length - n).join('/');
}

/**
 * 把扁平进程列表按 cwd（项目目录）分组。同目录的进程归为一组，组名取目录最后
 * 一段；cwd 为空（打不开/受保护进程）归到「未分组」，且总是排在最后。
 * 组内按组大小降序排列（大组在前）。
 *
 * 精确 cwd（PEB 直读，按需通道）通过 preciseCwdByPid 旁路传入，优先于启发式
 * ProcessInfo.cwd：能修正 cmdline 无绝对路径（如 `npm run dev`）导致的误归未分组。
 * 缓存一旦填充即冻结（在 store 层），此处只是读取——分组键取精确值，缺失回退启发式。
 */
export function groupByProject(
  procs: ProcessInfo[],
  preciseCwdByPid?: Record<number, string>,
): ProjectGroup[] {
  const UNGROUPED = '未分组';
  const byDir = new Map<string, ProjectGroup>();
  const ungrouped: number[] = [];
  let ungroupedMem = 0;

  for (const proc of procs) {
    const mem = proc.workingSetBytes;
    // 精确 cwd 优先；缺失回退启发式
    const cwd = preciseCwdByPid?.[proc.pid] ?? proc.cwd;
    if (cwd && cwd.trim()) {
      const dir = normPath(cwd);
      let g = byDir.get(dir);
      if (!g) {
        g = { name: lastSegment(cwd) || dir, dir, pids: [], totalMemory: 0 };
        byDir.set(dir, g);
      }
      g.pids.push(proc.pid);
      g.totalMemory += mem;
    } else {
      ungrouped.push(proc.pid);
      ungroupedMem += mem;
    }
  }

  const groups = [...byDir.values()].sort((a, b) => b.pids.length - a.pids.length);
  disambiguateNames(groups);
  if (ungrouped.length > 0) {
    groups.push({ name: UNGROUPED, dir: null, pids: ungrouped, totalMemory: ungroupedMem });
  }
  return groups;
}

/**
 * 对同名组逐级加父段消歧显示名。只改 group.name（显示），不改 group.dir（分组键）。
 * dir 为 null 的组（未分组）不参与——未分组在调用方单独 append，不传入此函数。
 *
 * 算法：从 n=1（basename）开始，统计每个 name 的冲突数；冲突的组升到 n+1 段，
 * 直到组间 name 唯一。实践中倒数两段几乎必然唯一。
 */
function disambiguateNames(groups: ProjectGroup[]): void {
  // 只处理有 dir 的组（dir===null 的未分组不在此列表）
  const withDir = groups.filter((g) => g.dir !== null) as (ProjectGroup & { dir: string })[];
  if (withDir.length === 0) return;
  let n = 1;
  // 上限：最长路径的段数（保证一定能消歧到完整路径）
  const maxSegs = Math.max(...withDir.map((g) => normPath(g.dir).split('/').filter(Boolean).length));
  while (n <= maxSegs) {
    // 计算每组的第 n 级候选名
    const candidate = new Map<ProjectGroup, string>();
    for (const g of withDir) candidate.set(g, lastSegments(g.dir, n));
    // 统计冲突
    const counts = new Map<string, number>();
    for (const name of candidate.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
    const hasCollision = [...counts.values()].some((c) => c > 1);
    if (!hasCollision) {
      // 无冲突：应用候选名，停止
      for (const g of withDir) g.name = candidate.get(g)!;
      return;
    }
    n++;
  }
  // 兜底：仍未唯一（理论上 maxSegs 时已是完整路径，必唯一）——用完整规范化路径
  for (const g of withDir) g.name = normPath(g.dir);
}
