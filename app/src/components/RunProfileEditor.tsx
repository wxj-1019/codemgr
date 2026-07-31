import { useState } from 'react';
import type { RunProfile } from '../../electron/ipc-types';
import { ipc } from '../lib/ipc';
import { refreshProfiles } from '../hooks/useRunProfiles';
import { Dialog } from './ui/Dialog';

const COMMAND_OPTIONS = ['node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'git'];

export function RunProfileEditor({
  editing,
  onClose,
}: {
  editing: RunProfile | null;  // null = 新建
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [command, setCommand] = useState(editing?.command ?? 'pnpm');
  const [argsText, setArgsText] = useState((editing?.args ?? []).join(' '));
  const [cwd, setCwd] = useState(editing?.cwd ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !cwd.trim()) {
      setError('名称和工作目录不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      const result = await ipc.saveRunProfile({
        id: editing?.id,
        name: name.trim(),
        command,
        args,
        cwd: cwd.trim(),
      });
      if (!result) {
        setError('保存失败：command 不在白名单或 cwd 非绝对路径');
      } else {
        await refreshProfiles();
        onClose();
      }
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={editing ? '编辑 Profile' : '新建 Profile'}
      widthClass="w-full max-w-md"
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-content-muted">名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface-panel px-2 py-1 text-content-primary" placeholder="前端 dev" />
        </label>
        <label className="block">
          <span className="text-content-muted">命令（白名单）</span>
          <select value={command} onChange={(e) => setCommand(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface-panel px-2 py-1 text-content-primary">
            {COMMAND_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-content-muted">参数（空格分隔）</span>
          <input value={argsText} onChange={(e) => setArgsText(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface-panel px-2 py-1 font-mono text-content-primary" placeholder="dev" />
        </label>
        <label className="block">
          <span className="text-content-muted">工作目录（绝对路径）</span>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface-panel px-2 py-1 font-mono text-content-primary" placeholder="E:\repo\app" />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded border border-line px-4 py-1.5 text-sm text-content-secondary hover:bg-surface-raised">取消</button>
        <button onClick={save} disabled={saving} className="rounded bg-accent px-4 py-1.5 text-sm text-on-accent hover:bg-accent/80 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </Dialog>
  );
}
