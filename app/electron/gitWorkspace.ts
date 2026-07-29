import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { GitIdentity } from './ipc-types';

// 规范化 Windows 路径：大写盘符 + 正斜杠，剥 NT 前缀（与 projectGroup.normPath 对齐）。
function normPath(p: string): string {
  return p
    .replace(/^(?:\\\?\?\\|\\\\\?\\)/i, '')
    .replace(/\\/g, '/')
    .replace(/^[a-z]:/, (m) => m.toUpperCase())
    .replace(/\/$/, '');
}

// 读文件首行去尾换行；文件不存在/读失败返回 null。
function readLine(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

// 向上递归找 .git，返回 { gitEntry: .git 路径, treeRoot: 工作树根 }。
function findGitDir(startDir: string): { gitEntry: string; treeRoot: string } | null {
  let dir = normPath(startDir).replace(/\//g, path.sep);
  for (let i = 0; i < 40; i++) {
    const dotGit = path.join(dir, '.git');
    if (existsSync(dotGit)) return { gitEntry: dotGit, treeRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 从 cwd 解析 Git 仓库身份（B，按需）。纯 fs 文件解析，不 spawn git。
 * 非 git 目录 / 解析失败 → null。详见 spec §3。
 */
export function resolveGitIdentity(cwd: string): GitIdentity | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const found = findGitDir(cwd);
  if (!found) return null;
  const { gitEntry, treeRoot } = found;
  const gitStat = statSync(gitEntry);

  let commonDir: string;
  let isWorktree: boolean;

  if (gitStat.isDirectory()) {
    commonDir = gitEntry;
    isWorktree = false;
  } else {
    // .git 是文件 → 链接 worktree，内容形如 "gitdir: <path>"
    const content = readLine(gitEntry);
    if (!content || !content.startsWith('gitdir:')) return null;
    const gitdirPath = content.slice('gitdir:'.length).trim();
    // gitdirPath 指向 <mainRepo>/.git/worktrees/<name>
    const commondirFile = path.join(gitdirPath, 'commondir');
    const cd = readLine(commondirFile);
    if (!cd) return null; // 非 worktree（如 submodule）→ 首轮不支持，降级 null
    commonDir = path.isAbsolute(cd) ? cd : path.resolve(gitdirPath, cd);
    isWorktree = true;
  }

  // 解析 HEAD
  const headContent = readLine(path.join(commonDir, 'HEAD'));
  if (headContent === null) return null;

  let branch: string | null;
  let detached: boolean;
  let head: string;

  if (headContent.startsWith('ref: ')) {
    const ref = headContent.slice('ref: '.length).trim();
    detached = false;
    head = ref;
    const m = ref.match(/^refs\/heads\/(.+)$/);
    branch = m ? m[1] : null;
  } else {
    detached = true;
    branch = null;
    head = headContent;
  }

  return {
    gitRoot: normPath(treeRoot),
    commonDir: normPath(commonDir),
    branch,
    head,
    detached,
    isWorktree,
  };
}
