import { useState } from 'react';
import { useProcessPanel } from '../hooks/useProcessPanel';
import { useProcessPanelStore } from '../store/processPanelStore';
import { ipc } from '../lib/ipc';
import { ProcessTable } from './ProcessTable';
import { ConfirmDialog } from './ConfirmDialog';

export function ProcessPanel() {
  useProcessPanel(); // Start polling (2s interval)

  const { processes, loading, selectedPids, filter, setFilter, clearSelection } =
    useProcessPanelStore();

  const [pendingKill, setPendingKill] = useState<{
    pid: number;
    name: string;
  } | null>(null);

  const [batchKillName, setBatchKillName] = useState<string | null>(null);

  async function doKillSingle() {
    if (!pendingKill) return;
    await ipc.killProcess(pendingKill.pid);
    setPendingKill(null);
  }

  async function doBatchKill() {
    if (!batchKillName) return;
    await ipc.killByName(batchKillName);
    setBatchKillName(null);
    clearSelection();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">进程</h1>
          <p className="text-xs text-slate-500">
            {processes.length} 个进程
            {loading ? ' · 刷新中…' : ''}
            {selectedPids.size > 0 && ` · 已选 ${selectedPids.size} 个`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="搜索进程/命令行/PID…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-56 rounded border border-base-600 bg-base-800 px-3 py-1 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-accent/50"
          />
          {selectedPids.size > 0 && (
            <button
              onClick={() => {
                // Pick the most-common name among the selected PIDs as the
                // batch target.  This avoids killing unrelated processes
                // when the user has selected a mix of different names.
                const selectedNames = [...selectedPids]
                  .map(
                    (pid) =>
                      processes.find((p) => p.pid === pid)?.name || '',
                  )
                  .filter(Boolean);

                const freq: Record<string, number> = {};
                let best = '';
                for (const n of selectedNames) {
                  freq[n] = (freq[n] || 0) + 1;
                  if (freq[n] > (freq[best] || 0)) best = n;
                }

                if (best) setBatchKillName(best);
              }}
              className="rounded bg-red-600/80 px-3 py-1 text-xs text-white hover:bg-red-500"
            >
              批量结束 ({selectedPids.size})
            </button>
          )}
        </div>
      </header>

      {/* Process tree table */}
      <ProcessTable
        onKillSingle={(pid, name) => setPendingKill({ pid, name })}
      />

      {/* Single-kill confirmation */}
      <ConfirmDialog
        open={pendingKill !== null}
        title="结束进程"
        message={`确定结束 ${pendingKill?.name}（PID ${pendingKill?.pid}）吗？`}
        confirmLabel="结束进程"
        onConfirm={doKillSingle}
        onCancel={() => setPendingKill(null)}
      />

      {/* Batch-kill confirmation */}
      <ConfirmDialog
        open={batchKillName !== null}
        title="批量结束进程"
        message={`确定结束所有 ${batchKillName} 进程吗？（已选 ${selectedPids.size} 个）`}
        confirmLabel="批量结束"
        onConfirm={doBatchKill}
        onCancel={() => setBatchKillName(null)}
      />
    </div>
  );
}
