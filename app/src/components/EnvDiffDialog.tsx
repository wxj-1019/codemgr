import { useEffect, useState } from 'react';
import type { ProcessInfo } from '../../electron/ipc-types';
import { ipc } from '../lib/ipc';
import { diffEnv, type EnvDiffResult } from '../lib/envDiff';
import { Dialog } from './ui/Dialog';

interface Props {
  a: ProcessInfo;
  b: ProcessInfo;
  onClose: () => void;
}

/** 两进程环境变量对比（子项目 F）：打开并行拉两边 env，三组差异展示。 */
export function EnvDiffDialog({ a, b, onClose }: Props) {
  const [state, setState] = useState<'loading' | 'error' | 'done'>('loading');
  const [diff, setDiff] = useState<EnvDiffResult | null>(null);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      const [ea, eb] = await Promise.all([ipc.fetchProcessEnv(a.pid), ipc.fetchProcessEnv(b.pid)]);
      if (stopped) return;
      if (ea === null || eb === null) { setState('error'); return; }
      setDiff(diffEnv(ea, eb));
      setState('done');
    })();
    return () => { stopped = true; };
  }, [a.pid, b.pid]);

  const label = (p: ProcessInfo) => `${p.name} (PID ${p.pid})`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="对比环境变量"
      description={`A：${label(a)}  ↔  B：${label(b)}`} widthClass="w-[640px]">
      {state === 'loading' && <p className="text-sm text-fg-muted">读取环境变量中…</p>}
      {state === 'error' && <p className="text-sm text-danger">读取失败：权限不足或进程已退出</p>}
      {state === 'done' && diff && (
        <div className="max-h-[60vh] space-y-3 overflow-auto text-xs">
          <section>
            <h4 className="mb-1 font-medium text-fg-primary">值不同（{diff.changed.length}）</h4>
            {diff.changed.length === 0 ? <p className="text-fg-muted">无</p> : diff.changed.map((c) => (
              <div key={c.key} className="mb-1 rounded border border-base-700 bg-base-900 p-1.5 font-mono">
                <div className="text-accent">{c.key}</div>
                <div className="break-all text-fg-muted">A: {c.aVal}</div>
                <div className="break-all text-fg-secondary">B: {c.bVal}</div>
              </div>
            ))}
          </section>
          <section>
            <h4 className="mb-1 font-medium text-fg-primary">仅 A 有（{diff.removed.length}）</h4>
            {diff.removed.length === 0 ? <p className="text-fg-muted">无</p> : (
              <p className="break-all font-mono text-fg-secondary">{diff.removed.join(', ')}</p>
            )}
          </section>
          <section>
            <h4 className="mb-1 font-medium text-fg-primary">仅 B 有（{diff.added.length}）</h4>
            {diff.added.length === 0 ? <p className="text-fg-muted">无</p> : (
              <p className="break-all font-mono text-fg-secondary">{diff.added.join(', ')}</p>
            )}
          </section>
          <p className="text-fg-muted">相同 {diff.sameCount} 个变量</p>
        </div>
      )}
    </Dialog>
  );
}
