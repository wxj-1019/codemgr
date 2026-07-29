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
  if (ungrouped.length > 0) {
    groups.push({ name: UNGROUPED, dir: null, pids: ungrouped, totalMemory: ungroupedMem });
  }
  return groups;
}
