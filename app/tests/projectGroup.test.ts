import { describe, it, expect } from 'vitest';
import { groupByProject } from '../src/lib/projectGroup';
import type { ProcessInfo } from '../electron/ipc-types';

const p = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1, ppid: 0, name: 'node.exe', cmdline: '', kernelTimeMs: 0, userTimeMs: 0,
  workingSetBytes: 0, createTimeMs: 0, threadCount: 0, handleCount: 0, cwd: '',
  ...over,
});

describe('groupByProject', () => {
  it('groups by identical cwd', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\proj\\app' }),
      p({ pid: 3, cwd: 'C:\\other' }),
    ]);
    expect(groups.length).toBe(2);
    const app = groups.find(g => g.name === 'app');
    expect(app?.pids).toEqual([1, 2]);
  });

  it('group name is last path segment of cwd', () => {
    const groups = groupByProject([p({ pid: 1, cwd: 'C:\\proj\\my-app' })]);
    expect(groups[0].name).toBe('my-app');
  });

  it('processes with empty cwd go to 未分组', () => {
    const groups = groupByProject([p({ pid: 1, cwd: '' }), p({ pid: 2, cwd: '' })]);
    expect(groups[0].name).toBe('未分组');
    expect(groups[0].pids.length).toBe(2);
  });

  it('未分组 always last', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: '' }),
      p({ pid: 2, cwd: 'C:\\proj\\a' }),
    ]);
    expect(groups[groups.length - 1].name).toBe('未分组');
  });

  it('groups sorted by size descending', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\small' }),
      p({ pid: 2, cwd: 'C:\\big' }),
      p({ pid: 3, cwd: 'C:\\big' }),
    ]);
    // big (2 procs) before small (1 proc); 未分组 absent here
    expect(groups[0].pids.length).toBeGreaterThanOrEqual(groups[1].pids.length);
  });

  it('strips \\??\\ NT prefix so precise cwd groups with heuristic cwd', () => {
    // 启发式 cwd 给 Win32 路径，精确 cwd（PEB 直读）可能带 \??\ 前缀；两者应归同组
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: '\\??\\C:\\proj\\app' }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].pids).toEqual([1, 2]);
  });

  it('strips \\\\?\\ NT prefix', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: '\\\\?\\C:\\dev\\svc' }),
      p({ pid: 2, cwd: 'C:\\dev\\svc' }),
    ]);
    expect(groups.length).toBe(1);
  });

  // ── 精确 cwd（旁路缓存）接入分组 ──

  it('precise cwd rescues empty heuristic cwd out of 未分组', () => {
    // 启发式 cwd 为空（cmdline 无绝对路径，如 npm run dev）原本落未分组；
    // 精确 cwd（PEB 直读）应把它归到正确项目组
    const groups = groupByProject(
      [p({ pid: 1, cwd: '' })],
      { 1: 'D:\\work\\app' },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('app');
    expect(groups[0].dir).toBe('D:/work/app');
    expect(groups[0].pids).toEqual([1]);
  });

  it('precise cwd overrides wrong heuristic cwd', () => {
    // 启发式抽到错误目录（首个盘符路径是脚本而非 cwd）；精确值修正分组
    const groups = groupByProject(
      [p({ pid: 1, cwd: 'C:\\wrong' })],
      { 1: 'C:\\work\\app' },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('app');
    expect(groups[0].pids).toEqual([1]);
  });

  it('precise and heuristic of same value group together (no dup)', () => {
    const groups = groupByProject(
      [p({ pid: 1, cwd: 'C:\\proj\\app' }), p({ pid: 2, cwd: 'C:\\proj\\app' })],
      { 2: 'C:\\proj\\app' },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].pids).toEqual([1, 2]);
  });

  it('precise cwd NT prefix is stripped before grouping', () => {
    // 精确 cwd 带 \??\ 前缀，与启发式 Win32 路径应归同组
    const groups = groupByProject(
      [p({ pid: 1, cwd: 'C:\\proj\\app' })],
      { 1: '\\??\\C:\\proj\\app' },
    );
    expect(groups.length).toBe(1);
    expect(groups[0].pids).toEqual([1]);
  });

  it('omitting preciseCwdByPid is backward compatible', () => {
    // 第二参数可选；不传时行为与现状完全一致（回归保护）
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: '' }),
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0].name).toBe('app');
    expect(groups[groups.length - 1].name).toBe('未分组');
  });

  // ── bug #3：同名 worktree 显示名消歧 + identity 键唯一 ──

  it('disambiguates same-basename groups by parent segment', () => {
    // 两个不同完整路径、相同 basename（app）→ 两组，name 加父段消歧
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\worktrees\\x\\app' }),
    ]);
    expect(groups.length).toBe(2);
    const names = groups.map((g) => g.name);
    // 两个 name 不应相同（消歧生效）
    expect(new Set(names).size).toBe(2);
    // 消歧后 name 应包含 basename
    expect(names.every((n) => n.endsWith('app'))).toBe(true);
  });

  it('keeps basename when no collision', () => {
    // 唯一 basename 不消歧（回归保护：现有行为）
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\other\\svc' }),
    ]);
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(['app', 'svc']);
  });

  it('dir (identity key) stays unique and normalized across same-basename groups', () => {
    const groups = groupByProject([
      p({ pid: 1, cwd: 'C:\\proj\\app' }),
      p({ pid: 2, cwd: 'C:\\worktrees\\x\\app' }),
    ]);
    const dirs = groups.map((g) => g.dir);
    expect(new Set(dirs).size).toBe(2); // identity 键唯一
    expect(dirs).toContain('C:/proj/app');
    expect(dirs).toContain('C:/worktrees/x/app');
  });
});
