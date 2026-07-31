import { useState } from 'react';
import { useRunProfiles, refreshProfiles } from '../hooks/useRunProfiles';
import { useRunProfileStore } from '../store/runProfileStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { useNotice } from '../hooks/useNotice';
import { ipc } from '../lib/ipc';
import { resolveServiceStatus, type ServiceStatus } from '../lib/devService';
import { RunProfileEditor } from './RunProfileEditor';
import { ConfirmDialog } from './ConfirmDialog';
import { PanelActionBar } from './ui/PanelActionBar';
import { PanelAlert } from './ui/PanelAlert';
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
  const loadError = useRunProfileStore((s) => s.loadError);
  const connections = usePortRadarStore((s) => s.connections);
  const [editing, setEditing] = useState<RunProfile | null | undefined>(undefined); // undefined=关闭, null=新建, profile=编辑
  const [busy, setBusy] = useState<string | null>(null);  // 正在操作的 profileId
  const [pendingDelete, setPendingDelete] = useState<RunProfile | null>(null);
  // 操作结果反馈横幅（UX-07/UX-17）：取代原生 alert，自动消失
  const { notice, show: showNotice } = useNotice();

  function runOf(profileId: string) {
    return runs.find((r) => r.profileId === profileId && r.status === 'running');
  }

  // 最近一次失败（UX-05：spawn error 后展示原因，用户据此重试）。
  // 已有运行中实例时不展示旧失败——重试成功后徽章不残留（UX 回归修复）。
  function failedRunOf(profileId: string) {
    if (runOf(profileId)) return undefined;
    return runs
      .filter((r) => r.profileId === profileId && r.status === 'failed')
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  async function start(profileId: string) {
    setBusy(profileId);
    try {
      const r = await ipc.startProfile(profileId);
      if (!r) showNotice('danger', '启动失败：command 不在白名单或 cwd 无效');
    } catch (e) { showNotice('danger', `启动失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function stop(runId: string, profileId: string) {
    setBusy(profileId);
    try {
      // 返回值 = killTree 实际结束的进程数；0 说明根进程受保护/已退出（UX-07）
      const killed = await ipc.stopProfile(runId);
      showNotice(
        killed > 0 ? 'success' : 'danger',
        killed > 0 ? `已停止（结束 ${killed} 个进程）` : '停止失败：未结束任何进程（可能受保护或已退出）',
      );
    } catch (e) { showNotice('danger', `停止失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function restart(runId: string, profileId: string) {
    setBusy(profileId);
    try {
      const r = await ipc.restartProfile(runId);
      if (!r) showNotice('danger', '重启失败：run 不存在或配置无效');
    } catch (e) { showNotice('danger', `重启失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function doDelete() {
    if (!pendingDelete) return;
    const profile = pendingDelete;
    setPendingDelete(null);
    try {
      const ok = await ipc.deleteRunProfile(profile.id);
      if (!ok) showNotice('danger', '删除失败：文件写入出错');
      await refreshProfiles();
    } catch (e) { showNotice('danger', `删除失败：${String(e)}`); }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="Run Profiles"
        summary={`${profiles.length} 个配置 · ${runs.filter((r) => r.status === 'running').length} 个运行中`}
        actions={
          <button onClick={() => setEditing(null)} className="rounded-md bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover">新建</button>
        }
      />
      {notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}
      {loadError && <PanelAlert tone="danger">加载 Run Profiles 失败：{loadError}</PanelAlert>}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {profiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-content-muted">
            尚无 Run Profile。点「新建」配置一个开发服务（如 pnpm dev）。
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => {
              const run = runOf(p.id);
              const failedRun = failedRunOf(p.id);
              const isBusy = busy === p.id;
              return (
                <div key={p.id} className="rounded-lg border border-line bg-surface-panel/60 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-content-primary">{p.name}</span>
                      {run && <span className="ml-2 rounded bg-success/20 px-1 text-[10px] text-success">PID {run.pid}</span>}
                      {failedRun && (
                        <span
                          className="ml-1 rounded bg-danger/20 px-1 text-[10px] text-danger"
                          title={failedRun.error ?? '启动失败'}
                        >
                          启动失败
                        </span>
                      )}
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
                        <button onClick={() => start(p.id)} disabled={isBusy} className="rounded bg-accent/80 px-2 py-0.5 text-xs text-on-accent hover:bg-accent disabled:opacity-50">启动</button>
                      ) : (
                        <>
                          <button onClick={() => restart(run.runId, p.id)} disabled={isBusy} className="rounded bg-surface-raised px-2 py-0.5 text-xs text-content-secondary hover:bg-surface-raised disabled:opacity-50">重启</button>
                          <button onClick={() => stop(run.runId, p.id)} disabled={isBusy} className="rounded border border-danger/40 bg-transparent px-2 py-0.5 text-xs text-danger hover:bg-danger hover:text-on-accent disabled:opacity-50">停止</button>
                        </>
                      )}
                      <button onClick={() => setEditing(p)} className="rounded bg-surface-raised px-2 py-0.5 text-xs text-content-secondary hover:bg-surface-raised">编辑</button>
                      <button onClick={() => setPendingDelete(p)} className="rounded bg-surface-raised px-2 py-0.5 text-xs text-content-muted hover:bg-surface-raised">删</button>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-content-muted">{p.command} {p.args.join(' ')}</div>
                  <div className="font-mono text-xs text-content-muted truncate">{p.cwd}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing !== undefined && <RunProfileEditor editing={editing} onClose={() => setEditing(undefined)} />}

      {/* 删除确认（UX-07/UX-17：原生 confirm → ConfirmDialog，失败有反馈） */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除 Run Profile"
        message={pendingDelete ? `确定删除「${pendingDelete.name}」吗？此操作无法撤销。` : ''}
        confirmLabel="删除配置"
        onConfirm={doDelete}
        onCancel={() => { if (!busy) setPendingDelete(null); }}
      />
    </div>
  );
}
