// 进程右键菜单构建（ProcessTable 树视图与 ProjectGroupView 项目视图共用）。
// 此前两处各自内联定义相同菜单（复制命令行/复制 PID），此模块收敛为一处。
import type { ContextMenuItem } from '../components/ContextMenu';
import type { OpenTargetKind } from '../../electron/ipc-types';

export interface ProcessMenuTarget {
  pid: number;
  name: string;
  cmdline: string;
  cwd: string;
}

export interface ProcessMenuHandlers {
  onOpenTarget: (kind: OpenTargetKind, path: string) => void;
  onCopy: (text: string) => void;
  onKillSingle: (pid: number, name: string) => void;
  onKillTree: (pid: number, name: string) => void;
}

/**
 * 菜单约定：导航动作在上，复制居中，danger 沉底。
 * - 打开/复制 cwd 在 cwd 为空（系统进程、权限不足）时禁用。
 * - 结束进程树：树视图传 hasChildren=真实父子关系；项目视图无树信息，传 true（按 pid>4 放行）。
 */
export function buildProcessMenuItems(
  proc: ProcessMenuTarget,
  opts: { hasChildren: boolean },
  handlers: ProcessMenuHandlers,
): ContextMenuItem[] {
  const noCwd = !proc.cwd;
  return [
    { label: '打开所在文件夹', disabled: noCwd, onSelect: () => handlers.onOpenTarget('folder', proc.cwd) },
    { label: '在终端打开', disabled: noCwd, onSelect: () => handlers.onOpenTarget('terminal', proc.cwd) },
    { label: '在编辑器打开', disabled: noCwd, onSelect: () => handlers.onOpenTarget('editor', proc.cwd) },
    { label: '复制命令行', dividerBefore: true, disabled: !proc.cmdline, onSelect: () => handlers.onCopy(proc.cmdline) },
    { label: '复制 PID', onSelect: () => handlers.onCopy(String(proc.pid)) },
    { label: '复制工作目录', disabled: noCwd, onSelect: () => handlers.onCopy(proc.cwd) },
    { label: '结束进程', dividerBefore: true, danger: true, onSelect: () => handlers.onKillSingle(proc.pid, proc.name) },
    ...(opts.hasChildren && proc.pid > 4
      ? [{ label: '结束进程树', danger: true as const, onSelect: () => handlers.onKillTree(proc.pid, proc.name) }]
      : []),
  ];
}
