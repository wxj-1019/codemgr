import { useState } from 'react';
import { usePortRadar } from '../hooks/usePortRadar';
import { usePortRadarStore } from '../store/portRadarStore';
import { ipc } from '../lib/ipc';
import { PortTable } from './PortTable';
import { ConfirmDialog } from './ConfirmDialog';
import { LoadState } from './LoadState';

export function PortRadar() {
  usePortRadar();  // 启动轮询
  const { connections, loading, error, selectedPid, select } = usePortRadarStore();
  const [pendingKill, setPendingKill] = useState<{ pid: number; name: string } | null>(null);

  async function doKill() {
    if (!pendingKill) return;
    const ok = await ipc.killProcess(pendingKill.pid);
    if (!ok) {
      alert(`结束 ${pendingKill.name} (PID ${pendingKill.pid}) 失败：可能需要管理员权限，或进程已退出。`);
    }
    setPendingKill(null);
  }

  const listenCount = connections.filter(
    (c) => c.protocol === 'udp' || c.state === 'LISTENING'
  ).length;
  // 错误降级为横幅，而非整屏替换：有数据 + 出错时保留表格，仅在表头下挂一条
  // 可关闭的红色横幅；只有「无数据 + 出错」或「首次加载 + loading」才走整屏状态。
  const hasData = connections.length > 0;
  const isFirstLoad = connections.length === 0 && !error;
  const showErrorBanner = !!error && hasData;
  const showLoadState = (isFirstLoad && loading) || (!!error && !hasData);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">端口雷达</h1>
          <p className="text-xs text-fg-muted">
            {listenCount} 个监听端口{loading ? ' · 刷新中…' : ''}
            {error && ' · 上次刷新出错'}
          </p>
        </div>
      </header>

      {showErrorBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-red-700/40 bg-red-950/30 px-4 py-2">
          <p className="truncate text-xs text-red-300">
            上次刷新失败：{error}
          </p>
          <button
            onClick={() => usePortRadarStore.getState().setError(null)}
            className="shrink-0 text-red-400 hover:text-red-200"
            aria-label="关闭错误提示"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 overflow-hidden p-2">
        {showLoadState ? (
          <LoadState
            loading={loading}
            error={error}
            empty={connections.length === 0 && !loading && !error}
            emptyText="暂无监听端口"
            isFirstLoad={isFirstLoad}
          />
        ) : (
          <PortTable
            connections={connections}
            selectedPid={selectedPid}
            onSelect={(pid) => select(pid)}
            onKill={(pid, name) => setPendingKill({ pid, name })}
          />
        )}
      </main>

      <ConfirmDialog
        open={pendingKill !== null}
        title="结束进程"
        message={`确定结束 ${pendingKill?.name}（PID ${pendingKill?.pid}）吗？该进程的所有子操作将被中断。`}
        confirmLabel="结束进程"
        onConfirm={doKill}
        onCancel={() => setPendingKill(null)}
      />
    </div>
  );
}
