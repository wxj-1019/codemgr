import { useState } from 'react';
import { useRunProfiles, refreshProfiles } from '../hooks/useRunProfiles';
import { useRunProfileStore } from '../store/runProfileStore';
import { ipc } from '../lib/ipc';
import { RunProfileEditor } from './RunProfileEditor';
import type { RunProfile } from '../../electron/ipc-types';

export function RunProfilesPanel() {
  useRunProfiles();
  const profiles = useRunProfileStore((s) => s.profiles);
  const runs = useRunProfileStore((s) => s.runs);
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
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">Run Profiles</h1>
          <p className="text-xs text-fg-muted">{profiles.length} 个配置 · {runs.filter((r) => r.status === 'running').length} 个运行中</p>
        </div>
        <button onClick={() => setEditing(null)} className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent/80">新建</button>
      </header>
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
                      {run && <span className="ml-2 rounded bg-green-500/20 px-1 text-[10px] text-green-400">running · PID {run.pid}</span>}
                    </div>
                    <div className="flex gap-1">
                      {!run ? (
                        <button onClick={() => start(p.id)} disabled={isBusy} className="rounded bg-accent/80 px-2 py-0.5 text-xs text-white hover:bg-accent disabled:opacity-50">启动</button>
                      ) : (
                        <>
                          <button onClick={() => restart(run.runId, p.id)} disabled={isBusy} className="rounded bg-base-700 px-2 py-0.5 text-xs text-fg-secondary hover:bg-base-600 disabled:opacity-50">重启</button>
                          <button onClick={() => stop(run.runId, p.id)} disabled={isBusy} className="rounded bg-red-600/80 px-2 py-0.5 text-xs text-white hover:bg-red-500 disabled:opacity-50">停止</button>
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
