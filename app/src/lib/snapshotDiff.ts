import type { SnapshotEntry } from '../../electron/ipc-types';

/**
 * 进程快照对比（v2.2，spec §2.3）。
 *
 * 纯函数：输入两个 SnapshotEntry[]（base = 快照、current = 当前），输出 added /
 * removed / changed 三组。identity 用 `pid:createTimeMs`——PID 会被系统复用，单 pid
 * 会把「旧进程退出 + 新进程同 pid」误判为 unchanged，故必须组合 createTimeMs。
 *
 * 三组语义：
 *  - added   : current 有、base 没有（快照后新起的进程）
 *  - removed : base 有、current 没有（快照后退出的进程）
 *  - changed : identity 相同但 name/cmdline/cwd 变化（罕见：进程重 exec、chdir）
 *
 * changed 的判定字段：name / cmdline / cwd（不含 createTimeMs，因 createTimeMs
 * 已用于 identity 匹配；不含 workingSetBytes——内存抖动是常态，纳入会淹没真正的
 * 结构变化，见 bug #5）。进程重 exec（node→deno）会同时改 name/cmdline，仍能被捕获。
 */

export interface ChangedPair {
  before: SnapshotEntry;
  after: SnapshotEntry;
}

export interface SnapshotDiff {
  added: SnapshotEntry[];
  removed: SnapshotEntry[];
  changed: ChangedPair[];
}

/**
 * identity 键：`${pid}:${createTimeMs}`。同 pid 不同 createTimeMs 视为不同进程
 * （PID 复用防护，spec §2.2）。
 */
export function snapshotIdentity(e: { pid: number; createTimeMs: number }): string {
  return `${e.pid}:${e.createTimeMs}`;
}

/**
 * 判断两条 identity 相同的条目是否「有变化」。只比较结构字段 name/cmdline/cwd。
 * 注意 createTimeMs 已用于 identity 匹配，此处不再比较。
 *
 * workingSetBytes 不纳入 changed 判定（bug #5 修复）：内存抖动是存活进程的
 * 常态，纳入会让快照「有变化」列表被内存波动淹没，淹没真正的结构变化。
 * 进程重 exec（node→deno）会同时改 name/cmdline，仍能被捕获；
 * 内存泄漏/资源异常检测属于「资源异常」范畴，留给后续 AI Session 资源聚合，
 * 不塞进快照身份 diff。
 */
function entryChanged(before: SnapshotEntry, after: SnapshotEntry): boolean {
  return (
    before.name !== after.name ||
    before.cmdline !== after.cmdline ||
    before.cwd !== after.cwd
  );
}

/**
 * 对比 base（快照）与 current（当前），返回 added/removed/changed 三组。
 *
 * 算法：以 identity 为键建 base map，遍历 current——命中且变化 → changed，未命中 → added；
 * 然后遍历 base 找出 current 未命中的 → removed。O(n+m) 时间。
 *
 * 输出顺序：按输入原顺序（不重排），便于 UI 稳定渲染。同一 identity 在输入里
 * 重复时取首次出现（快照里同 pid+createTimeMs 重复是脏数据，但保守处理不抛错）。
 */
export function diffSnapshots(base: SnapshotEntry[], current: SnapshotEntry[]): SnapshotDiff {
  // base map：identity -> 首个匹配条目（重复时取首个，避免重复 matched）
  const baseMap = new Map<string, SnapshotEntry>();
  for (const e of base) {
    const k = snapshotIdentity(e);
    if (!baseMap.has(k)) baseMap.set(k, e);
  }

  const added: SnapshotEntry[] = [];
  const changed: ChangedPair[] = [];
  // 记录 current 命中过的 identity，用于后续计算 removed（未命中的 base）
  const matched = new Set<string>();

  // seenInCurrent：current 里已处理过的 identity（防脏数据里同 identity 重复
  // 导致 added/changed 重复入列——快照里同 pid+createTimeMs 重复是异常但保守去重）。
  const seenInCurrent = new Set<string>();
  for (const cur of current) {
    const k = snapshotIdentity(cur);
    if (seenInCurrent.has(k)) continue;        // 同 identity 第二份跳过
    seenInCurrent.add(k);
    const b = baseMap.get(k);
    if (b) {
      matched.add(k);
      if (entryChanged(b, cur)) {
        changed.push({ before: b, after: cur });
      }
      // identity 相同且字段无变化 → unchanged，三组都不进
    } else {
      added.push(cur);
    }
  }

  const removed: SnapshotEntry[] = [];
  for (const e of base) {
    const k = snapshotIdentity(e);
    if (!matched.has(k)) {
      // 同一 identity 在 base 里重复时只 push 一次 removed（用 matched 标记去重）
      matched.add(k);
      removed.push(e);
    }
  }

  return { added, removed, changed };
}
