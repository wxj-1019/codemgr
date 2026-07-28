import { useState } from 'react';
import { useProcessPanel } from '../hooks/useProcessPanel';
import { useProcessPanelStore } from '../store/processPanelStore';
import { ipc } from '../lib/ipc';
import { mostCommonName } from '../lib/batchKill';
import { ProcessTable } from './ProcessTable';
import { ProjectGroupView } from './ProjectGroupView';
import { ConfirmDialog } from './ConfirmDialog';
import { LoadState } from './LoadState';

export function ProcessPanel() {
  useProcessPanel(); // Start polling (2s interval)

  const {
    processes, loading, error, selectedPids, filter, setFilter, clearSelection,
    viewMode, toggleViewMode,
  } = useProcessPanelStore();

  const [pendingKill, setPendingKill] = useState<{
    pid: number;
    name: string;
  } | null>(null);

  // Batch kill of *selected* PIDs (targets explicit pids, never same-name procs
  // elsewhere on the system). Holds the most-common name among the selection
  // purely for the confirmation dialog copy.
  const [batchKillName, setBatchKillName] = useState<string | null>(null);

  // Separate confirm state for the one-click "kill ALL node.exe" preset. This
  // path intentionally uses killByName (system-wide) because that is exactly
  // what the preset promises — but native guard list still protects
  // svchost/system/electron/CodeMgr.
  const [confirmKillAllNode, setConfirmKillAllNode] = useState(false);

  // Group-kill (project view): 结束本组 kills every pid in the group via
  // killByPids. We hold the group name + pid count for the confirm dialog copy.
  const [groupKill, setGroupKill] = useState<{ name: string; pids: number[] } | null>(null);

  async function doKillSingle() {
    if (!pendingKill) return;
    const ok = await ipc.killProcess(pendingKill.pid);
    setPendingKill(null);
    if (!ok) {
      alert('结束失败：权限不足或进程已退出');
    }
  }

  async function doBatchKill() {
    if (!batchKillName) return;
    const killed = await ipc.killByPids([...selectedPids]);
    setBatchKillName(null);
    clearSelection();
    alert(`已结束 ${killed} 个进程`);
  }

  async function doKillAllNode() {
    const killed = await ipc.killByName('node.exe');
    setConfirmKillAllNode(false);
    clearSelection();
    alert(`已结束 ${killed} 个 node.exe 进程`);
  }

  async function doKillGroup() {
    if (!groupKill) return;
    const killed = await ipc.killByPids(groupKill.pids);
    const name = groupKill.name;
    setGroupKill(null);
    alert(`已结束 ${name} 组内 ${killed} 个进程`);
  }

  // 错误降级为横幅，而非整屏替换：有数据 + 出错时保留进程表，仅在表头下挂一条
  // 可关闭的红色横幅；只有「无数据 + 出错」或「首次加载 + loading」才走整屏状态。
  const hasData = processes.length > 0;
  const isFirstLoad = processes.length === 0 && !error;
  const showErrorBanner = !!error && hasData;
  const showLoadState = (isFirstLoad && loading) || (!!error && !hasData);

  // Show the one-click "kill all node.exe" preset only when at least one
  // node.exe is actually present in the current snapshot.
  const hasNode = processes.some((p) => p.name.toLowerCase() === 'node.exe');

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">进程</h1>
          <p className="text-xs text-fg-muted">
            {processes.length} 个进程
            {loading ? ' · 刷新中…' : ''}
            {error && ' · 上次刷新出错'}
            {selectedPids.size > 0 && ` · 已选 ${selectedPids.size} 个`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="搜索进程/命令行/PID…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-56 rounded border border-base-600 bg-base-800 px-3 py-1 text-sm text-fg-primary placeholder-fg-muted outline-none focus:border-accent/50"
          />
          <button
            onClick={toggleViewMode}
            className="rounded border border-base-600 bg-base-800 px-3 py-1 text-xs text-fg-secondary hover:bg-base-700"
            title={viewMode === 'tree' ? '切换到按项目分组视图' : '切换到树形视图'}
          >
            {viewMode === 'tree' ? '📁 按项目' : '🌲 树形'}
          </button>
          {hasNode && (
            <button
              onClick={() => setConfirmKillAllNode(true)}
              className="rounded bg-orange-600/80 px-3 py-1 text-xs text-white hover:bg-orange-500"
              title="结束系统中所有 node.exe 进程（受保护名单排除）"
            >
              结束所有 node.exe
            </button>
          )}
          {selectedPids.size > 0 && (
            <button
              onClick={() => {
                // Pick the most-common name among the selected PIDs as the
                // batch target label. The kill itself targets explicit PIDs
                // (killByPids), so unrelated same-name processes elsewhere are
                // never touched.
                const name = mostCommonName(
                  [...selectedPids].map(
                    (pid) => processes.find((p) => p.pid === pid)?.name || '',
                  ),
                );
                if (name) setBatchKillName(name);
              }}
              className="rounded bg-red-600/80 px-3 py-1 text-xs text-white hover:bg-red-500"
            >
              批量结束 ({selectedPids.size})
            </button>
          )}
        </div>
      </header>

      {showErrorBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-red-700/40 bg-red-950/30 px-4 py-2">
          <p className="truncate text-xs text-red-300">
            上次刷新失败：{error}
          </p>
          <button
            onClick={() => useProcessPanelStore.getState().setError(null)}
            className="shrink-0 text-red-400 hover:text-red-200"
            aria-label="关闭错误提示"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      {/* 加载/错误/空状态，或进程表 */}
      <div className="flex-1 overflow-hidden">
        {showLoadState ? (
          <LoadState
            loading={loading}
            error={error}
            empty={false}
            isFirstLoad={isFirstLoad}
          />
        ) : viewMode === 'project' ? (
          <ProjectGroupView
            onKillSingle={(pid, name) => setPendingKill({ pid, name })}
            onKillGroup={(name, pids) => setGroupKill({ name, pids })}
          />
        ) : (
          <ProcessTable
            onKillSingle={(pid, name) => setPendingKill({ pid, name })}
          />
        )}
      </div>

      {/* Single-kill confirmation */}
      <ConfirmDialog
        open={pendingKill !== null}
        title="结束进程"
        message={`确定结束 ${pendingKill?.name}（PID ${pendingKill?.pid}）吗？`}
        confirmLabel="结束进程"
        onConfirm={doKillSingle}
        onCancel={() => setPendingKill(null)}
      />

      {/* Batch-kill confirmation — targets explicit selected PIDs */}
      <ConfirmDialog
        open={batchKillName !== null}
        title="批量结束进程"
        message={`确定结束选中的 ${selectedPids.size} 个进程（均为 ${batchKillName}）吗？`}
        confirmLabel="批量结束"
        onConfirm={doBatchKill}
        onCancel={() => setBatchKillName(null)}
      />

      {/* Kill-all-node confirmation — system-wide, guarded by native protection list */}
      <ConfirmDialog
        open={confirmKillAllNode}
        title="结束所有 node.exe"
        message="将结束系统中所有 node.exe 进程（受保护进程如 CodeMgr/electron 会被自动排除）。确定继续吗？"
        confirmLabel="全部结束"
        onConfirm={doKillAllNode}
        onCancel={() => setConfirmKillAllNode(false)}
      />

      {/* Group-kill confirmation (project view) — targets the explicit pids in the group */}
      <ConfirmDialog
        open={groupKill !== null}
        title="结束本组进程"
        message={
          groupKill
            ? `确定结束「${groupKill.name}」组内的 ${groupKill.pids.length} 个进程吗？`
            : ''
        }
        confirmLabel="结束本组"
        onConfirm={doKillGroup}
        onCancel={() => setGroupKill(null)}
      />
    </div>
  );
}
