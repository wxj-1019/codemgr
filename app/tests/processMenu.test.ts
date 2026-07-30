import { describe, it, expect } from 'vitest';
import { buildProcessMenuItems, type ProcessMenuHandlers, type ProcessMenuTarget } from '../src/lib/processMenu';

const proc: ProcessMenuTarget = { pid: 1234, name: 'node.exe', cmdline: 'node server.js', cwd: 'C:\\proj' };

function makeHandlers(): ProcessMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onOpenTarget: (kind, path) => calls.push(`open:${kind}:${path}`),
    onCopy: (t) => calls.push(`copy:${t}`),
    onKillSingle: (pid) => calls.push(`kill:${pid}`),
    onKillTree: (pid) => calls.push(`killtree:${pid}`),
  };
}

describe('buildProcessMenuItems', () => {
  it('菜单顺序：打开三项 → 复制三项 → kill 沉底', () => {
    const items = buildProcessMenuItems(proc, { hasChildren: true }, makeHandlers());
    expect(items.map((i) => i.label)).toEqual([
      '打开所在文件夹', '在终端打开', '在编辑器打开',
      '复制命令行', '复制 PID', '复制工作目录',
      '结束进程', '结束进程树',
    ]);
    expect(items[6]!.danger).toBe(true);
    expect(items[7]!.danger).toBe(true);
  });
  it('打开动作回调 kind + cwd', () => {
    const h = makeHandlers();
    const items = buildProcessMenuItems(proc, { hasChildren: false }, h);
    items[0]!.onSelect();
    items[1]!.onSelect();
    items[2]!.onSelect();
    expect(h.calls).toEqual([
      'open:folder:C:\\proj', 'open:terminal:C:\\proj', 'open:editor:C:\\proj',
    ]);
  });
  it('无 cwd：打开三项与复制工作目录禁用', () => {
    const items = buildProcessMenuItems({ ...proc, cwd: '' }, { hasChildren: false }, makeHandlers());
    expect(items[0]!.disabled).toBe(true);
    expect(items[1]!.disabled).toBe(true);
    expect(items[2]!.disabled).toBe(true);
    expect(items[5]!.disabled).toBe(true);
    expect(items[3]!.disabled).toBeFalsy(); // 复制命令行仍可用
  });
  it('无 cmdline：复制命令行禁用', () => {
    const items = buildProcessMenuItems({ ...proc, cmdline: '' }, { hasChildren: false }, makeHandlers());
    expect(items[3]!.disabled).toBe(true);
  });
  it('结束进程树仅 hasChildren 且 pid>4 出现', () => {
    const noChild = buildProcessMenuItems(proc, { hasChildren: false }, makeHandlers());
    expect(noChild.find((i) => i.label === '结束进程树')).toBeUndefined();
    const sysProc = buildProcessMenuItems({ ...proc, pid: 4 }, { hasChildren: true }, makeHandlers());
    expect(sysProc.find((i) => i.label === '结束进程树')).toBeUndefined();
  });
});
