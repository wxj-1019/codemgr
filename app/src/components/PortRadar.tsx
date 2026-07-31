import { useState } from 'react';
import { usePortRadar } from '../hooks/usePortRadar';
import { usePortRadarStore } from '../store/portRadarStore';
import { useFocusStore } from '../store/focusStore';
import { useNotice } from '../hooks/useNotice';
import { ipc } from '../lib/ipc';
import { filterConnections, isListenLike } from '../lib/portFilter';
import { PortTable } from './PortTable';
import { ConfirmDialog } from './ConfirmDialog';
import { LoadState } from './LoadState';
import { PollIntervalSelect } from './PollIntervalSelect';
import { formatRelativeTime } from '../lib/format';
import { PanelActionBar } from './ui/PanelActionBar';
import { PanelAlert } from './ui/PanelAlert';
import { IconButton } from './ui/IconButton';
import { Search, X } from './icons';

export function PortRadar() {
  usePortRadar();  // 启动轮询
  const {
    connections, loading, error, selectedPid, select, filter, setFilter,
    pollMs, setPollMs, staleAt,
  } = usePortRadarStore();
  const focus = useFocusStore((s) => s.focus);
  const [pendingKill, setPendingKill] = useState<{ pid: number; name: string } | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  // 操作结果反馈横幅（UX-03/UX-17）：取代原生 alert，自动消失
  const { notice, show: showNotice } = useNotice();

  async function doKill() {
    if (!pendingKill || killBusy) return;
    setKillBusy(true);
    try {
      const status = await ipc.killProcess(pendingKill.pid);
      if (status === 'killed') {
        showNotice('success', `已结束 ${pendingKill.name}（PID ${pendingKill.pid}）`);
      } else {
        // UX-02/04：native 返回枚举，失败原因不再三合一
        const reason = status === 'protected'
          ? '受保护进程，无法结束'
          : status === 'denied'
            ? '权限不足（可能需要以管理员身份运行）'
            : '进程已退出';
        showNotice('danger', `结束 ${pendingKill.name}（PID ${pendingKill.pid}）失败：${reason}`);
      }
      setPendingKill(null);
    } catch (e) {
      setPendingKill(null);
      showNotice('danger', `结束失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  const visible = filterConnections(connections, filter);
  const listenCount = visible.filter(isListenLike).length;
  // 错误降级为横幅，而非整屏替换：有数据 + 出错时保留表格，仅在表头下挂一条
  // 可关闭的红色横幅；只有「无数据 + 出错」或「首次加载 + loading」才走整屏状态。
  const hasData = connections.length > 0;
  const isFirstLoad = connections.length === 0 && !error;
  const showErrorBanner = !!error && hasData;
  const showLoadState = (isFirstLoad && loading) || (!!error && !hasData);

  // 拼接状态摘要文本（监听数 / 刷新中 / 出错 / 数据陈旧）
  const summary = `${listenCount} 个监听端口${loading ? ' · 刷新中…' : ''}${error ? ' · 上次刷新出错' : ''}${
    staleAt !== null ? ` · 数据陈旧（${formatRelativeTime(staleAt)}）` : ''
  }`;

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="端口雷达"
        summary={summary}
        actions={
          <>
            <PollIntervalSelect value={pollMs} onChange={setPollMs} />
            <div className="relative min-w-32 max-w-48 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-content-muted" aria-hidden="true" />
              <input
                type="text"
                placeholder="搜索端口/进程/PID/地址…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full max-w-48 rounded-md border border-line bg-surface-raised py-1 pl-7 pr-2 text-sm text-content-primary placeholder-content-muted outline-none focus:border-focus/60"
              />
            </div>
          </>
        }
      />

      {showErrorBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2">
          <p className="truncate text-xs text-danger">
            上次刷新失败：{error}
          </p>
          <IconButton
            label="关闭错误提示"
            size="xs"
            variant="ghost"
            onClick={() => usePortRadarStore.getState().setError(null)}
            className="text-danger/80 hover:text-danger"
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      )}

      {notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}

      <main className="flex min-h-0 flex-1 overflow-hidden p-2">
        {showLoadState ? (
          <LoadState
            loading={loading}
            error={error}
            empty={connections.length === 0 && !loading && !error}
            emptyText="暂无监听端口"
            isFirstLoad={isFirstLoad}
            paused={pollMs === 0}
          />
        ) : (
          <PortTable
            connections={visible}
            selectedPid={selectedPid}
            onSelect={(pid) => { select(pid); focus(pid, 'port'); }}
            onKill={(pid, name) => setPendingKill({ pid, name })}
          />
        )}
      </main>

      <ConfirmDialog
        open={pendingKill !== null}
        title="结束进程"
        message={`确定结束 ${pendingKill?.name}（PID ${pendingKill?.pid}）吗？`}
        confirmLabel="结束进程"
        busy={killBusy}
        onConfirm={doKill}
        onCancel={() => { if (!killBusy) setPendingKill(null); }}
      />
    </div>
  );
}
