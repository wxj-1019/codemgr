import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGitIdentity } from '../electron/gitWorkspace';

// 在 tmpdir 下造一个 git 仓库结构，返回根路径。
function makeRepo(opts: { head?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'cm-git-'));
  const gitDir = join(root, '.git');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), opts.head ?? 'ref: refs/heads/main\n');
  return root;
}

describe('resolveGitIdentity', () => {
  let repos: string[] = [];
  afterEach(() => {
    for (const r of repos) {
      if (existsSync(r)) rmSync(r, { recursive: true, force: true });
    }
    repos = [];
  });

  it('resolves a normal repo on branch', () => {
    const root = makeRepo({ head: 'ref: refs/heads/feature/login\n' });
    repos.push(root);
    const id = resolveGitIdentity(root);
    expect(id).not.toBeNull();
    expect(id!.branch).toBe('feature/login');
    expect(id!.detached).toBe(false);
    expect(id!.isWorktree).toBe(false);
    expect(id!.gitRoot.replace(/\\/g, '/')).toBe(root.replace(/\\/g, '/'));
  });

  it('resolves detached HEAD', () => {
    const root = makeRepo({ head: '0123456789abcdef0123456789abcdef01234567\n' });
    repos.push(root);
    const id = resolveGitIdentity(root);
    expect(id).not.toBeNull();
    expect(id!.branch).toBeNull();
    expect(id!.detached).toBe(true);
    expect(id!.head.startsWith('0123456789')).toBe(true);
  });

  it('finds .git from a subdirectory (walks up)', () => {
    const root = makeRepo();
    repos.push(root);
    const sub = join(root, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    const id = resolveGitIdentity(sub);
    expect(id).not.toBeNull();
    expect(id!.branch).toBe('main');
  });

  it('returns null for non-git directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-nongit-'));
    repos.push(root);
    expect(resolveGitIdentity(root)).toBeNull();
  });

  it('returns null for empty cwd', () => {
    expect(resolveGitIdentity('')).toBeNull();
  });

  it('resolves a linked worktree (.git is a file with gitdir:)', () => {
    const mainRepo = makeRepo();
    repos.push(mainRepo);
    const wt = mkdtempSync(join(tmpdir(), 'cm-wt-'));
    repos.push(wt);
    const wtMeta = join(mainRepo, '.git', 'worktrees', 'wt-name');
    mkdirSync(wtMeta, { recursive: true });
    writeFileSync(join(wtMeta, 'commondir'), join(mainRepo, '.git') + '\n');
    writeFileSync(join(wtMeta, 'gitdir'), join(wt, '.git') + '\n');
    writeFileSync(join(wt, '.git'), 'gitdir: ' + wtMeta + '\n');
    const id = resolveGitIdentity(wt);
    expect(id).not.toBeNull();
    expect(id!.isWorktree).toBe(true);
    expect(id!.branch).toBe('main');
  });

  it('returns null when .git file has invalid format (no gitdir:)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-badgit-'));
    repos.push(root);
    writeFileSync(join(root, '.git'), 'garbage content\n');
    expect(resolveGitIdentity(root)).toBeNull();
  });
});
