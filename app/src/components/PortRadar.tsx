import { useState } from 'react';
import { usePortRadar } from '../hooks/usePortRadar';
import { usePortRadarStore } from '../store/portRadarStore';
import { useFocusStore } from '../store/focusStore';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';
import { filterConnections, isListenLike } from '../lib/portFilter';
import { buildExportName, connectionsToCsv, toPrettyJson } from '../lib/exportData';
import { PortTable } from './PortTable';
import { ConfirmDialog } from './ConfirmDialog';
import { StateView } from './ui/StateView';
import { ContextMenu } from './ContextMenu';
import { PollIntervalSelect } from './PollIntervalSelect';
import { formatRelativeTime } from '../lib/format';
import { PanelActionBar } from './ui/PanelActionBar';
import { IconButton } from './ui/IconButton';
import { Download, Search, X } from './icons';

export function PortRadar() {
  usePortRadar();  // 启动轮询
  const {
    connections, loading, error, lastErrorAt, selectedPid, select, filter, setFilter,
    pollMs, setPollMs, staleAt,
  } = usePortRadarStore();
  const focus = useFocusStore((s) => s.focus);
  const [pendingKill, setPendingKill] = useState<{ pid: number; name: string } | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  // UX-19：仅监听（默认）/ 全部连接（含 ESTABLISHED 等）切换——设计文档 §3.1 承诺
  const [showAll, setShowAll] = useState(false);

  // 数据导出（子项目 E）：当前过滤视图 → CSV/JSON，main 保存对话框持路径
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);

  async function doExport(format: 'csv' | 'json') {
    const content = format === 'csv' ? connectionsToCsv(visible) : toPrettyJson(visible);
    const res = await ipc.exportDataFile(buildExportName('ports', format), content);
    if (res === 'ok') notify.success('已导出');
    else if (res === 'error') notify.error('导出失败');
  }

  async function doKill() {
    if (!pendingKill || killBusy) return;
    setKillBusy(true);
    try {
      const status = await ipc.killProcess(pendingKill.pid);
      if (status === 'killed') {
        notify.success(`已结束 ${pendingKill.name}（PID ${pendingKill.pid}）`);
      } else {
        // UX-02/04：native 返回枚举，失败原因不再三合一
        const reason = status === 'protected'
          ? '受保护进程，无法结束'
          : status === 'denied'
            ? '权限不足（可能需要以管理员身份运行）'
            : '进程已退出';
        notify.error(`结束 ${pendingKill.name}（PID ${pendingKill.pid}）失败：${reason}`);
      }
      setPendingKill(null);
    } catch (e) {
      setPendingKill(null);
      notify.error(`结束失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  const visible = filterConnections(connections, filter);
  const listenCount = visible.filter(isListenLike).length;
  // UX-19/UX-21：摘要计数随过滤词变化会误导（"5 个监听端口"实为"匹配 5 个"）
  const summaryCount = showAll ? visible.length : listenCount;
  // 错误降级为横幅，而非整屏替换：有数据 + 出错时保留表格，仅在表头下挂一条
  // 可关闭的红色横幅；只有「无数据 + 出错」或「首次加载 + loading」才走整屏状态。
  const hasData = connections.length > 0;
  const isFirstLoad = connections.length === 0 && !error;
  // UX-27：错误恢复后横幅保留 60s（单次短暂失败不至于一闪而过）
  const recentError = lastErrorAt !== null && Date.now() - lastErrorAt < 60000;
  const showErrorBanner = (!!error || recentError) && hasData;
  const showLoadState = (isFirstLoad && loading) || (!!error && !hasData);

  // 拼接状态摘要文本（监听数/连接数 / 刷新中 / 出错 / 数据陈旧）
  const summary = `${summaryCount} 个${showAll ? '连接' : '监听端口'}${loading ? ' · 刷新中…' : ''}${error ? ' · 上次刷新出错' : ''}${
    staleAt !== null ? ` · 数据陈旧（${formatRelativeTime(staleAt)}）` : ''
  }`;

  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="端口雷达"
        summary={summary}
        actions={
          <>
            <button
              onClick={() => setShowAll((v) => !v)}
              aria-pressed={showAll}
              className={`rounded-lg border px-2 py-1 text-xs ${
                showAll
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-line bg-surface-raised text-content-secondary hover:bg-surface-overlay'
              }`}
              title={showAll ? '显示全部连接（含已建立连接）' : '仅显示监听中的端口'}
            >
              {showAll ? '全部连接' : '仅监听'}
            </button>
            <PollIntervalSelect value={pollMs} onChange={setPollMs} />
            <div className="relative min-w-32 max-w-48 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-content-muted" aria-hidden="true" />
              <input
                type="text"
                placeholder="搜索端口/进程/PID/地址…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full max-w-48 rounded-md border border-line bg-surface-raised py-1 pl-7 pr-7 text-sm text-content-primary placeholder-content-muted outline-none focus:border-focus/60"
              />
              {filter !== '' && (
                <IconButton
                  label="清除搜索"
                  size="xs"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-primary"
                  onClick={() => setFilter('')}
                >
                  <X size={12} aria-hidden="true" />
                </IconButton>
              )}
            </div>
            <IconButton label="导出" size="sm" onClick={(e) => setExportMenu({ x: e.clientX, y: e.clientY })}>
              <Download />
            </IconButton>
          </>
        }
      />

      {showErrorBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2">
          <p className="truncate text-xs text-danger">
            {error ? `上次刷新失败：${error}` : '上次刷新出错（已恢复）'}
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

      <main className="flex min-h-0 flex-1 overflow-hidden p-2">
        {showLoadState ? (
          error ? (
            <StateView state="error" title="加载失败" description={error} />
          ) : (
            <StateView state="loading" title="加载中…" />
          )
        ) : (
          <PortTable
            connections={visible}
            selectedPid={selectedPid}
            showAll={showAll}
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
      <ContextMenu
        open={exportMenu !== null}
        x={exportMenu?.x ?? 0}
        y={exportMenu?.y ?? 0}
        items={[
          { label: '导出 CSV', onSelect: () => void doExport('csv') },
          { label: '导出 JSON', onSelect: () => void doExport('json') },
        ]}
        onClose={() => setExportMenu(null)}
      />
    </div>
  );
}