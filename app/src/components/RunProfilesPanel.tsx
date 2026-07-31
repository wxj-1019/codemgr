import { useEffect, useRef, useState } from 'react';
import { useRunProfiles, refreshProfiles } from '../hooks/useRunProfiles';
import { useRunProfileStore } from '../store/runProfileStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';
import { resolveServiceStatus, type ServiceStatus, type ServiceStatusKind } from '../lib/devService';
import { diffServiceEvents, browseUrlForService } from '../lib/serviceWatch';
import { openExternalUrlOrNotify } from '../lib/shellClient';
import { RunProfileEditor } from './RunProfileEditor';
import { RunLogView } from './RunLogView';
import { ConfirmDialog } from './ConfirmDialog';
import { PanelActionBar } from './ui/PanelActionBar';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Globe } from './icons';
import type { RunProfile } from '../../electron/ipc-types';

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

  // 行内日志（子项目 C）：一次只展开一行；取该 profile 最近一次 run（运行中或已退出均可查日志）
  const [logOpenFor, setLogOpenFor] = useState<string | null>(null);
  const latestRunOf = (profileId: string) =>
    runs.filter((r) => r.profileId === profileId).at(-1) ?? null;

  // 服务守望（子项目 D）：状态跃迁 toast（就绪/端口冲突），kind 不变不重复
  const prevKindsRef = useRef<Map<string, ServiceStatusKind>>(new Map());
  useEffect(() => {
    const next = new Map<string, { name: string; status: ServiceStatus }>();
    for (const p of profiles) {
      const run = runs.filter((r) => r.profileId === p.id).at(-1);
      if (run) next.set(p.id, { name: p.name, status: resolveServiceStatus(run, p, connections) });
    }
    for (const e of diffServiceEvents(prevKindsRef.current, next)) {
      if (e.type === 'listening') {
        notify.success(`「${e.profileName}」就绪：${e.ports.map((p) => ':' + p).join(', ')}`);
      } else {
        notify.error(`「${e.profileName}」端口被占用：${e.ports.map((p) => ':' + p).join(', ')}${e.heldBy.length ? `（PID ${e.heldBy.join(', ')}）` : ''}`);
      }
    }
    prevKindsRef.current = new Map([...next].map(([id, v]) => [id, v.status.kind]));
  }, [runs, connections, profiles]);

  async function start(profileId: string) {
    setBusy(profileId);
    try {
      const r = await ipc.startProfile(profileId);
      if (!r) notify.error('启动失败：command 不在白名单或 cwd 无效');
    } catch (e) { notify.error(`启动失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function stop(runId: string, profileId: string) {
    setBusy(profileId);
    try { await ipc.stopProfile(runId); }
    catch (e) { notify.error(`停止失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  async function restart(runId: string, profileId: string) {
    setBusy(profileId);
    try { await ipc.restartProfile(runId); }
    catch (e) { notify.error(`重启失败：${String(e)}`); }
    finally { setBusy(null); }
  }

  // 删除走 ConfirmDialog（替代原生 confirm）：del 只记录待删 id，doDelete 执行
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  function del(profileId: string) { setConfirmDelId(profileId); }

  async function doDelete() {
    if (!confirmDelId) return;
    setConfirmDelId(null);
    await ipc.deleteRunProfile(confirmDelId);
    await refreshProfiles();
  }

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="Run Profiles"
        summary={`${profiles.length} 个配置 · ${runs.filter((r) => r.status === 'running').length} 个运行中`}
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing(null)}>新建</Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {profiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-fg-muted">
            尚无 Run Profile。点「新建」配置一个开发服务（如 pnpm dev）。
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => {
              const run = runOf(p.id);
              const isBusy = busy === p.id;
              const svc = run ? resolveServiceStatus(run, p, connections) : null;
              const svcBadge = svc ? STATUS_BADGE[svc.kind] : null;
              const svcConflictInfo = svc?.kind === 'conflict' && svc.ports
                ? ' 占用: ' + svc.ports.filter((x) => x.conflict).map((x) => `:${x.port}(PID ${x.heldBy})`).join(', ')
                : '';
              const browseUrl = svc ? browseUrlForService(svc) : null;
              return (
                <div key={p.id} className="rounded-xl border border-line bg-surface-panel/60 p-3 transition-all duration-200 hover:bg-surface-raised/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-fg-primary">{p.name}</span>
                      {run && <Badge tone="success" className="ml-2">PID {run.pid}</Badge>}
                      {svcBadge && svcBadge.text && svc && (
                        <Badge tone={svc.kind === 'listening' ? 'success' : svc.kind === 'conflict' ? 'danger' : svc.kind === 'exited' ? 'neutral' : 'warning'} className="ml-1" title={svcConflictInfo || undefined}>
                          {svcBadge.text}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {!run ? (
                        <Button variant="primary" size="xs" onClick={() => start(p.id)} disabled={isBusy}>启动</Button>
                      ) : (
                        <>
                          <Button variant="secondary" size="xs" onClick={() => restart(run.runId, p.id)} disabled={isBusy}>重启</Button>
                          <Button variant="dangerQuiet" size="xs" onClick={() => stop(run.runId, p.id)} disabled={isBusy}>停止</Button>
                        </>
                      )}
                      <Button variant="secondary" size="xs" onClick={() => setEditing(p)}>编辑</Button>
                      <Button variant="ghost" size="xs" onClick={() => del(p.id)}>删</Button>
                      {browseUrl && (
                        <IconButton
                          label="在浏览器打开服务"
                          size="xs"
                          onClick={() => void openExternalUrlOrNotify(browseUrl)}
                        >
                          <Globe />
                        </IconButton>
                      )}
                      {latestRunOf(p.id) && (
                        <Button variant="secondary" size="xs" onClick={() => setLogOpenFor(logOpenFor === p.id ? null : p.id)}>
                          {logOpenFor === p.id ? '收起日志' : '日志'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-fg-muted">{p.command} {p.args.join(' ')}</div>
                  <div className="font-mono text-xs text-fg-muted truncate">{p.cwd}</div>
                  {logOpenFor === p.id && latestRunOf(p.id) && (
                    <RunLogView runId={latestRunOf(p.id)!.runId} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing !== undefined && <RunProfileEditor editing={editing} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={confirmDelId !== null}
        title="删除 Profile"
        message="确定删除此 profile？"
        confirmLabel="删除"
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelId(null)}
      />
    </div>
  );
}
