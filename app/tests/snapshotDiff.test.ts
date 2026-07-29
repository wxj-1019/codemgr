import { describe, it, expect } from 'vitest';
import { diffSnapshots, snapshotIdentity } from '../src/lib/snapshotDiff';
import type { SnapshotEntry } from '../electron/ipc-types';

const entry = (over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  pid: 100,
  createTimeMs: 1000,
  name: 'node.exe',
  cmdline: 'node index.js',
  cwd: 'C:\\proj\\app',
  workingSetBytes: 100 * 1024 * 1024,
  ...over,
});

describe('snapshotIdentity', () => {
  it('formats identity as pid:createTimeMs', () => {
    expect(snapshotIdentity(entry({ pid: 42, createTimeMs: 999 }))).toBe('42:999');
  });

  it('treats same pid + different createTimeMs as different identity', () => {
    // PID 复用防护的核心：只比 pid 不够，必须组合 createTimeMs（spec §2.2）
    const a = snapshotIdentity(entry({ pid: 7, createTimeMs: 100 }));
    const b = snapshotIdentity(entry({ pid: 7, createTimeMs: 200 }));
    expect(a).not.toBe(b);
  });
});

describe('diffSnapshots', () => {
  it('returns all-empty for two empty inputs', () => {
    const d = diffSnapshots([], []);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('base empty → all current are added', () => {
    const cur = [entry({ pid: 1 }), entry({ pid: 2 }), entry({ pid: 3 })];
    const d = diffSnapshots([], cur);
    expect(d.added).toHaveLength(3);
    expect(d.added.map((e) => e.pid).sort()).toEqual([1, 2, 3]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('current empty → all base are removed', () => {
    const base = [entry({ pid: 1 }), entry({ pid: 2 })];
    const d = diffSnapshots(base, []);
    expect(d.removed).toHaveLength(2);
    expect(d.removed.map((e) => e.pid).sort()).toEqual([1, 2]);
    expect(d.added).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('identical snapshots → all three groups empty (全等)', () => {
    const base = [entry({ pid: 1 }), entry({ pid: 2 })];
    // current 与 base 完全相同（含 createTimeMs + 所有字段）
    const cur = [entry({ pid: 1 }), entry({ pid: 2 })];
    const d = diffSnapshots(base, cur);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('detects added entries (current-only)', () => {
    const base = [entry({ pid: 1 })];
    const cur = [entry({ pid: 1 }), entry({ pid: 99, createTimeMs: 5000 })];
    const d = diffSnapshots(base, cur);
    expect(d.added).toHaveLength(1);
    expect(d.added[0].pid).toBe(99);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('detects removed entries (base-only)', () => {
    const base = [entry({ pid: 1 }), entry({ pid: 99, createTimeMs: 5000 })];
    const cur = [entry({ pid: 1 })];
    const d = diffSnapshots(base, cur);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].pid).toBe(99);
    expect(d.added).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('detects changed entries (same identity, different fields)', () => {
    // 同 pid + 同 createTimeMs，但 name/cmdline/cwd/workingSet 任一变化 → changed
    const base = [entry({ pid: 1, name: 'node.exe', cmdline: 'node a.js', cwd: 'C:\\a', workingSetBytes: 100 })];
    const cur = [entry({ pid: 1, name: 'node.exe', cmdline: 'node b.js', cwd: 'C:\\a', workingSetBytes: 100 })];
    const d = diffSnapshots(base, cur);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].before.cmdline).toBe('node a.js');
    expect(d.changed[0].after.cmdline).toBe('node b.js');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('workingSetBytes change alone does NOT count as changed', () => {
    // 内存抖动是常态，不应算进程身份/配置变化（spec bug #5）
    const base = [entry({ pid: 1, workingSetBytes: 100 })];
    const cur = [entry({ pid: 1, workingSetBytes: 200 })];
    const d = diffSnapshots(base, cur);
    expect(d.changed).toHaveLength(0);
  });

  it('structural change + workingSet change still counts as changed', () => {
    // 结构字段（name/cmdline/cwd）变化仍进 changed，内存移出不影响其捕获
    const base = [entry({ pid: 1, cmdline: 'node a.js', workingSetBytes: 100 })];
    const cur = [entry({ pid: 1, cmdline: 'node b.js', workingSetBytes: 200 })];
    const d = diffSnapshots(base, cur);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].after.cmdline).toBe('node b.js');
  });

  it('identity collision: same pid, different createTimeMs → added + removed (NOT unchanged)', () => {
    // PID 复用核心测试：旧进程(pid=7, t=100)退出，新进程(pid=7, t=200)起。
    // 只比 pid 会误判「未变」，组合 createTimeMs 后正确识别为「旧退出 + 新起」。
    const base = [entry({ pid: 7, createTimeMs: 100, name: 'old.exe' })];
    const cur = [entry({ pid: 7, createTimeMs: 200, name: 'new.exe' })];
    const d = diffSnapshots(base, cur);
    expect(d.added).toHaveLength(1);
    expect(d.added[0].pid).toBe(7);
    expect(d.added[0].createTimeMs).toBe(200);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].pid).toBe(7);
    expect(d.removed[0].createTimeMs).toBe(100);
    expect(d.changed).toEqual([]);
  });

  it('handles mix of added/removed/changed simultaneously', () => {
    const base = [
      entry({ pid: 1 }),                                    // unchanged
      entry({ pid: 2, name: 'old.exe' }),                   // will change (name differs)
      entry({ pid: 3, createTimeMs: 300 }),                 // will be removed
    ];
    const cur = [
      entry({ pid: 1 }),                                    // unchanged
      entry({ pid: 2, name: 'new.exe' }),                   // changed
      entry({ pid: 4, createTimeMs: 400 }),                 // added
    ];
    const d = diffSnapshots(base, cur);
    expect(d.added.map((e) => e.pid)).toEqual([4]);
    expect(d.removed.map((e) => e.pid)).toEqual([3]);
    expect(d.changed.map((c) => c.after.pid)).toEqual([2]);
    expect(d.changed[0].before.name).toBe('old.exe');
    expect(d.changed[0].after.name).toBe('new.exe');
  });

  it('preserves input order in added (no reordering)', () => {
    const cur = [
      entry({ pid: 30, createTimeMs: 30 }),
      entry({ pid: 10, createTimeMs: 10 }),
      entry({ pid: 20, createTimeMs: 20 }),
    ];
    const d = diffSnapshots([], cur);
    // 输出顺序应与 current 输入顺序一致，不重排
    expect(d.added.map((e) => e.pid)).toEqual([30, 10, 20]);
  });

  it('dedupes duplicate identity in base (only one removed)', () => {
    // 脏数据：base 里同 identity 重复。保守处理：removed 只 push 一次。
    const base = [
      entry({ pid: 5, createTimeMs: 500 }),
      entry({ pid: 5, createTimeMs: 500 }),                 // duplicate identity
    ];
    const d = diffSnapshots(base, []);
    expect(d.removed).toHaveLength(1);
  });

  it('dedupes duplicate identity in current (only matched once, no double changed)', () => {
    // 脏数据：current 里同 identity 重复。第二份既不进 added 也不重复进 changed。
    const base = [entry({ pid: 6, createTimeMs: 600, name: 'old' })];
    const cur = [
      entry({ pid: 6, createTimeMs: 600, name: 'new' }),    // changed
      entry({ pid: 6, createTimeMs: 600, name: 'new2' }),   // dup identity, skipped
    ];
    const d = diffSnapshots(base, cur);
    // 第一份命中并 change；第二份 identity 仍命中 base（但已 matched），
    // 不应再次入 changed（实现：用 baseMap 命中即判，重复 identity 会重复 push——
    // 此测试锁定「重复 identity 在 current 里只产生一次 changed」的契约）。
    expect(d.changed.map((c) => c.after.name)).toEqual(['new']);
  });
});
