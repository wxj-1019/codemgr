import { useState } from 'react';
import { useRunProfiles, refreshProfiles } from '../hooks/useRunProfiles';
import { useRunProfileStore } from '../store/runProfileStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { ipc } from '../lib/ipc';
import { resolveServiceStatus, type ServiceStatus } from '../lib/devService';
import { RunProfileEditor } from './RunProfileEditor';
import { PanelActionBar } from './ui/PanelActionBar';
import type { RunProfile, RunState } from '../../electron/ipc-types';

const STATUS_BADGE: Record<ServiceStatus['kind'], { text: string; cls: string }> = {
  listening: { text: '就绪', cls: 'bg-success/20 text-success' },
  starting: { text: '启动中…', cls: 'bg-warn/20 text-warn' },
  conflict: { text: '端口冲突', cls: 'bg-danger/20 text-danger' },
  exited: { text: '已退出', cls: 'bg-surface-raised text-content-muted' },
  'no-ports': { text: '', cls: '' },
};

export function RunProfilesPanel() {
  useRunProfiles();
  const profiles = useRunProfileStore((s) => s.profiles);
  const runs = useRunProfileStore((s) => s.runs);
  const connections = usePortRadarStore((s) => s.connections);
  const [editing, setEditing] = useState<RunProfile | null | undefined>(undefined); // undefined=关闭, null=新建, profile=编辑
  const [busy, setBusy] = useState<string | null>(null);  // 正在操作的 profileId

  function runOf(profileId: string) {
    return runs.find((r) => r.profileId === profileId && r.status === 'running');
  }

  async function start(profileId: string) {
    setBusy(profileId);
    try {
      const r = await ipc.startProfile(profileId);
      if (!r) alert('启动失败：command 不在白名单或 cwd 无效');
    } catch (e) { alert(`启动失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function stop(runId: string, profileId: string) {
    setBusy(profileId);
    try { await ipc.stopProfile(runId); }
    catch (e) { alert(`停止失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function restart(runId: string, profileId: string) {
    setBusy(profileId);
    try { await ipc.restartProfile(runId); }
    catch (e) { alert(`重启失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function del(profileId: string) {
    if (!confirm('确定删除此 profile？')) return;
    await ipc.deleteRunProfile(profileId);
    await refreshProfiles();
  }

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="Run Profiles"
        eyebrow="Run Profiles"
        summary={`${profiles.length} 个配置 · ${runs.filter((r) => r.status === 'running').length} 个运行中`}
        actions={
          <button onClick={() => setEditing(null)} className="rounded-md bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover">新建</button>
        }
      />
      <div className="flex-1 overflow-auto p-3">
        {profiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-fg-muted">
            尚无 Run Profile。点「新建」配置一个开发服务（如 pnpm dev）。
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => {
              const run = runOf(p.id);
              const isBusy = busy === p.id;
              return (
                <div key={p.id} className="rounded-lg border border-base-700 bg-base-800/60 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-fg-primary">{p.name}</span>
                      {run && <span className="ml-2 rounded bg-success/20 px-1 text-[10px] text-success">PID {run.pid}</span>}
                      {run && (() => {
                        const svc = resolveServiceStatus(run as RunState, p, connections);
                        const badge = STATUS_BADGE[svc.kind];
                        if (!badge.text) return null;
                        const conflictInfo = svc.kind === 'conflict' && svc.ports
                          ? ' 占用: ' + svc.ports.filter((x) => x.conflict).map((x) => `:${x.port}(PID ${x.heldBy})`).join(', ')
                          : '';
                        return (
                          <span className={`ml-1 rounded px-1 text-[10px] ${badge.cls}`} title={conflictInfo || undefined}>
                            {badge.text}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex gap-1">
                      {!run ? (
                        <button onClick={() => start(p.id)} disabled={isBusy} className="rounded bg-accent/80 px-2 py-0.5 text-xs text-white hover:bg-accent disabled:opacity-50">启动</button>
                      ) : (
                        <>
                          <button onClick={() => restart(run.runId, p.id)} disabled={isBusy} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600 disabled:opacity-50">重启</button>
                          <button onClick={() => stop(run.runId, p.id)} disabled={isBusy} className="rounded border border-danger/40 bg-transparent px-2 py-0.5 text-xs text-danger hover:bg-danger hover:text-on-accent disabled:opacity-50">停止</button>
                        </>
                      )}
                      <button onClick={() => setEditing(p)} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600">编辑</button>
                      <button onClick={() => del(p.id)} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-muted hover:bg-base-600">删</button>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-fg-muted">{p.command} {p.args.join(' ')}</div>
                  <div className="font-mono text-xs text-fg-muted truncate">{p.cwd}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing !== undefined && <RunProfileEditor editing={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
