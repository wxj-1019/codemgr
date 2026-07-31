// shell 跳转动作（子项目 A）：纯逻辑编排，不 import electron——依赖经 ShellDeps 注入，
// 便于 vitest 直测。安全约束：kind 白名单 + path 绝对路径且存在 + url 仅 http/https，
// 渲染层只传"打开什么"，结构上无法借此构造任意命令。
import type { OpenTargetKind } from './ipc-types';

export interface SpawnPlan {
  file: string;
  args: string[];
  options: Record<string, unknown>;
}

/** child_process.spawn 返回值的最小切面（测试可伪造）。 */
export interface SpawnLike {
  on(event: 'error', cb: (err: Error) => void): void;
  unref?(): void;
}

export interface ShellDeps {
  /** electron shell.openPath：返回 '' 成功，非空为错误描述。 */
  openPath: (p: string) => Promise<string>;
  /** electron shell.openExternal。 */
  openExternal: (url: string) => Promise<void>;
  spawn: (file: string, args: string[], options: Record<string, unknown>) => SpawnLike;
  /** `where <file>` 语义：可执行名是否在 PATH。 */
  commandExists: (file: string) => Promise<boolean>;
  /** fs.existsSync 语义。 */
  exists: (p: string) => boolean;
}

const KINDS: ReadonlySet<string> = new Set(['folder', 'terminal', 'editor']);

export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** 返回 null = 合法；非空字符串 = 错误描述（直接可给 UI）。 */
export function validateTarget(
  kind: string,
  path: string,
  exists: (p: string) => boolean,
): string | null {
  if (!KINDS.has(kind)) return `未知打开类型：${kind}`;
  if (!path || !isAbsolutePath(path)) return '路径不是绝对路径';
  if (!exists(path)) return '路径不存在或不可访问';
  return null;
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 终端计划：优先 Windows Terminal（wt -d），无 wt 回退 cmd start（用 cwd 选项落目录，避开 start 的引号标题陷阱）。 */
export function buildTerminalPlan(path: string, hasWt: boolean): SpawnPlan {
  return hasWt
    ? { file: 'wt.exe', args: ['-d', path], options: { detached: true, stdio: 'ignore' } }
    : { file: 'cmd.exe', args: ['/c', 'start', 'cmd.exe'], options: { detached: true, stdio: 'ignore', cwd: path } };
}

/** 编辑器计划：VS Code。Windows 上 code 是 code.cmd，必须 shell:true（Node 负责参数 quoting）。 */
export function buildEditorPlan(path: string): SpawnPlan {
  return { file: 'code', args: [path], options: { shell: true, detached: true, stdio: 'ignore' } };
}

/** 打开目标。返回 '' = 成功，非空 = 错误描述（照 shell.openPath 语义，UI 直接展示）。 */
export async function openTarget(kind: OpenTargetKind, path: string, deps: ShellDeps): Promise<string> {
  const invalid = validateTarget(kind, path, deps.exists);
  if (invalid) return invalid;
  try {
    if (kind === 'folder') return await deps.openPath(path);
    if (kind === 'terminal') {
      const plan = buildTerminalPlan(path, await deps.commandExists('wt.exe'));
      deps.spawn(plan.file, plan.args, plan.options).unref?.();
      return '';
    }
    // editor
    if (!(await deps.commandExists('code'))) return '未检测到 VS Code（code 命令不在 PATH）';
    const plan = buildEditorPlan(path);
    deps.spawn(plan.file, plan.args, plan.options).unref?.();
    return '';
  } catch (e) {
    return String(e);
  }
}

export async function openExternalUrl(
  url: string,
  deps: Pick<ShellDeps, 'openExternal'>,
): Promise<string> {
  if (!isSafeExternalUrl(url)) return `不允许打开的 URL：${url}`;
  try {
    await deps.openExternal(url);
    return '';
  } catch (e) {
    return String(e);
  }
}
