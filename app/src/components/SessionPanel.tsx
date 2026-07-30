import { useState } from 'react';
import { useSessions } from '../hooks/useSessions';
import { useSessionStore } from '../store/sessionStore';
import { useProcessPanelStore } from '../store/processPanelStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { useFocusStore } from '../store/focusStore';
import { aggregateSession } from '../lib/sessionAggregate';
import { formatBytes } from '../lib/format';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';
import { ConfirmDialog } from './ConfirmDialog';
import { PanelActionBar } from './ui/PanelActionBar';
import { Badge } from './ui/Badge';

export function SessionPanel() {
  useSessions(); // 启动订阅（订阅 processPanelStore，无独立轮询）
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useFocusStore((s) => s.focusedSessionId);
  const focusSession = useFocusStore((s) => s.focusSession);
  const focus = useFocusStore((s) => s.focus);
  const processes = useProcessPanelStore((s) => s.processes);
  const cpuMap = useProcessPanelStore((s) => s.cpuMap);
  const connections = usePortRadarStore((s) => s.connections);

  const [pendingStop, setPendingStop] = useState<{ rootPid: number; label: string } | null>(null);
  const [killBusy, setKillBusy] = useState(false);

  async function doStop() {
    if (!pendingStop || killBusy) return;
    setKillBusy(true);
    try {
      const killed = await ipc.killTree(pendingStop.rootPid);
      setPendingStop(null);
      if (killed === 0) {
        notify.error('未结束任何进程：根进程可能受保护、权限不足或已退出');
      }
      // session 在下次 processScan 刷新后自然消失
    } catch (e) {
      setPendingStop(null);
      notify.error(`停止会话失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelActionBar label="AI 会话" />
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-fg-muted">
          未检测到 AI 开发会话。<br />Codex / Claude / Aider / Cursor / Ollama 等运行时会出现在此。
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar label="AI 会话" summary={`${sessions.length} 个活跃会话`} />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="space-y-2">
          {sessions.map((s) => {
            const agg = aggregateSession(s.pids, processes, cpuMap, connections);
            const isFocused = focusedSessionId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => { focusSession(s.id); focus(s.rootPid, 'process'); }}
                className={`cursor-pointer rounded-lg border p-3 hover:bg-surface-panel ${
                  isFocused ? 'border-accent/70 ring-1 ring-accent/40' : 'border-line bg-surface-panel/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg-primary">{s.rootLabel}</span>
                    <Badge tone="accent">{s.kind}</Badge>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingStop({ rootPid: s.rootPid, label: s.rootLabel }); }}
                    className="rounded border border-danger/40 bg-transparent px-2 py-0.5 text-xs text-danger hover:bg-danger hover:text-on-accent"
                  >
                    停止
                  </button>
                </div>
                <div className="mt-1.5 flex gap-4 text-xs text-fg-muted">
                  <span>{agg.processCount} 进程</span>
                  <span className="font-mono text-fg-secondary">CPU {agg.totalCpu.toFixed(1)}%</span>
                  <span className="font-mono text-fg-secondary">{formatBytes(agg.totalMemory)}</span>
                  {agg.listenPortCount > 0 && <span className="text-accent">{agg.listenPortCount} 端口</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={pendingStop !== null}
        title="停止 AI 会话"
        message={pendingStop ? `确定停止「${pendingStop.label}」及其所有子进程吗？` : ''}
        confirmLabel="停止会话"
        busy={killBusy}
        onConfirm={doStop}
        onCancel={() => { if (!killBusy) setPendingStop(null); }}
      />
    </div>
  );
}
