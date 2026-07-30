import { useEffect, useRef, useState } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useProcessPanel } from '../hooks/useProcessPanel';
import { useProcessPanelStore } from '../store/processPanelStore';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';
import { mostCommonName } from '../lib/batchKill';
import { filterProcesses } from '../lib/processFilter';
import { processesToCsv, toPrettyJson, buildExportName } from '../lib/exportData';
import { ContextMenu } from './ContextMenu';
import { EnvDiffDialog } from './EnvDiffDialog';
import type { ProcessInfo } from '../../electron/ipc-types';
import { formatRelativeTime } from '../lib/format';
import { ProcessTable } from './ProcessTable';
import { ProjectGroupView } from './ProjectGroupView';
import { ProcessDetailSidebar } from './ProcessDetailSidebar';
import { ConfirmDialog } from './ConfirmDialog';
import { LoadState } from './LoadState';
import { PollIntervalSelect } from './PollIntervalSelect';
import { PanelActionBar } from './ui/PanelActionBar';
import { IconButton } from './ui/IconButton';
import { Download, Search, X } from './icons';
import { useContainerWidth } from '../hooks/useContainerWidth';

export function ProcessPanel() {
  useProcessPanel(); // Start polling (interval from store, default 2s)

  // 侧栏按容器（tile）宽度显隐，而非窗口宽度——多面板布局下 tile 宽度与窗口无关。
  // ≥720px 显示侧栏（容纳曲线 + 详情字段）。
  const panelRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(panelRef);
  const showSidebar = containerWidth !== null && containerWidth >= 720;

  const {
    processes, loading, error, selectedPids, filter, setFilter, clearSelection,
    viewMode, toggleViewMode, sidebarProportion, setSidebarProportion,
    pollMs, setPollMs, staleAt, cpuMap,
  } = useProcessPanelStore();

  // 数据导出（子项目 E）：当前过滤视图 → CSV/JSON，main 保存对话框持路径
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);

  async function doExport(format: 'csv' | 'json') {
    const rows = filterProcesses(processes, filter);
    const content = format === 'csv' ? processesToCsv(rows, cpuMap) : toPrettyJson(rows);
    const res = await ipc.exportDataFile(buildExportName('processes', format), content);
    if (res === 'ok') notify.success('已导出');
    else if (res === 'error') notify.error('导出失败');
  }

  // 环境变量对比（子项目 F）：恰好选中 2 个进程时可用，点击快照两个 ProcessInfo
  const [envDiffPair, setEnvDiffPair] = useState<{ a: ProcessInfo; b: ProcessInfo } | null>(null);

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

  // 结束进程树：native 按 ppid 链收集所有子孙后批量结束（保护名单逐 pid 生效）
  const [pendingKillTree, setPendingKillTree] = useState<{
    pid: number;
    name: string;
  } | null>(null);

  // 任一 kill 路径进行中时禁用确认按钮，防止连点重复 TerminateProcess。
  const [killBusy, setKillBusy] = useState(false);

  async function doKillSingle() {
    if (!pendingKill || killBusy) return;
    setKillBusy(true);
    try {
      const ok = await ipc.killProcess(pendingKill.pid);
      setPendingKill(null);
      if (!ok) {
        notify.error('结束失败：受保护进程、权限不足或进程已退出');
      }
    } catch (e) {
      setPendingKill(null);
      notify.error(`结束失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  async function doBatchKill() {
    if (!batchKillName || killBusy) return;
    setKillBusy(true);
    try {
      const targets = [...selectedPids];
      const killed = await ipc.killByPids(targets);
      setBatchKillName(null);
      clearSelection();
      if (killed === 0) {
        notify.error('未结束任何进程：可能均为受保护进程、权限不足或已退出');
      } else if (killed < targets.length) {
        notify.error(`已结束 ${killed}/${targets.length} 个进程（其余受保护/无权限/已退出）`);
      } else {
        notify.success(`已结束 ${killed} 个进程`);
      }
    } catch (e) {
      setBatchKillName(null);
      notify.error(`批量结束失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  async function doKillAllNode() {
    if (killBusy) return;
    setKillBusy(true);
    try {
      const killed = await ipc.killByName('node.exe');
      setConfirmKillAllNode(false);
      clearSelection();
      if (killed === 0) notify.error('未结束任何 node.exe：可能权限不足或进程已退出');
      else notify.success(`已结束 ${killed} 个 node.exe 进程`);
    } catch (e) {
      setConfirmKillAllNode(false);
      notify.error(`结束 node.exe 失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  async function doKillGroup() {
    if (!groupKill || killBusy) return;
    setKillBusy(true);
    try {
      const targets = groupKill.pids;
      const name = groupKill.name;
      const killed = await ipc.killByPids(targets);
      setGroupKill(null);
      if (killed === 0) {
        notify.error(`「${name}」组内未结束任何进程：可能受保护/无权限/已退出`);
      } else if (killed < targets.length) {
        notify.error(`已结束「${name}」组内 ${killed}/${targets.length} 个进程（其余受保护/无权限/已退出）`);
      } else {
        notify.success(`已结束「${name}」组内 ${killed} 个进程`);
      }
    } catch (e) {
      setGroupKill(null);
      notify.error(`结束本组失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  async function doKillTree() {
    if (!pendingKillTree || killBusy) return;
    setKillBusy(true);
    try {
      const killed = await ipc.killTree(pendingKillTree.pid);
      setPendingKillTree(null);
      clearSelection();
      if (killed === 0) notify.error('未结束任何进程：根进程可能受保护、权限不足或已退出');
      else notify.success(`已结束进程树，共 ${killed} 个进程`);
    } catch (e) {
      setPendingKillTree(null);
      notify.error(`结束进程树失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
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

  // 拼接状态摘要（进程数 / 刷新中 / 出错 / 陈旧 / 已选）
  const summary = `${processes.length} 个进程${loading ? ' · 刷新中…' : ''}${error ? ' · 上次刷新出错' : ''}${
    staleAt !== null ? ` · 数据陈旧（${formatRelativeTime(staleAt)}）` : ''
  }${selectedPids.size > 0 ? ` · 已选 ${selectedPids.size} 个` : ''}`;

  return (
    <div ref={panelRef} className="flex h-full flex-col">
      <PanelActionBar
        label="进程"
        summary={summary}
        actions={
          <>
            <PollIntervalSelect value={pollMs} onChange={setPollMs} />
            <div className="relative min-w-32 max-w-48 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-content-muted" aria-hidden="true" />
              <input
                type="text"
                placeholder="搜索进程/命令行/PID…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full max-w-48 rounded-md border border-line bg-surface-raised py-1 pl-7 pr-2 text-sm text-content-primary placeholder-content-muted outline-none focus:border-focus/60"
              />
            </div>
            <IconButton label="导出" size="sm" onClick={(e) => setExportMenu({ x: e.clientX, y: e.clientY })}>
              <Download />
            </IconButton>
          </>
        }
        secondaryActions={
          <>
            <button
              onClick={toggleViewMode}
              className="rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-content-secondary hover:bg-surface-overlay hover:text-content-primary"
              title={viewMode === 'tree' ? '切换到按项目分组视图' : '切换到树形视图'}
            >
              {viewMode === 'tree' ? '按项目' : '树形'}
            </button>
            {hasNode && (
              <button
                onClick={() => setConfirmKillAllNode(true)}
                className="rounded-md border border-danger/40 bg-transparent px-2 py-1 text-xs text-danger hover:bg-danger hover:text-on-accent"
                title="结束系统中所有 node.exe 进程（受保护名单排除）"
              >
                结束所有 node.exe
              </button>
            )}
            {selectedPids.size > 0 && (
              <button
                onClick={() => {
                  const name = mostCommonName(
                    [...selectedPids].map(
                      (pid) => processes.find((p) => p.pid === pid)?.name || '',
                    ),
                  );
                  if (name) setBatchKillName(name);
                }}
                className="rounded-md border border-danger/40 bg-transparent px-2 py-1 text-xs text-danger hover:bg-danger hover:text-on-accent"
              >
                批量结束 ({selectedPids.size})
              </button>
            )}
            {selectedPids.size === 2 && (
              <button
                onClick={() => {
                  const [p1, p2] = [...selectedPids]
                    .map((pid) => processes.find((p) => p.pid === pid))
                    .filter((x): x is ProcessInfo => !!x);
                  if (p1 && p2) setEnvDiffPair({ a: p1, b: p2 });
                }}
                className="rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-content-secondary hover:bg-surface-overlay hover:text-content-primary"
              >
                对比环境变量
              </button>
            )}
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
            onClick={() => useProcessPanelStore.getState().setError(null)}
            className="text-danger/80 hover:text-danger"
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      )}

      {/* 加载/错误/空状态，或进程表 + 可拖宽侧栏 */}
      {showLoadState ? (
        <div className="flex flex-1 overflow-hidden">
          <LoadState
            loading={loading}
            error={error}
            empty={false}
            isFirstLoad={isFirstLoad}
          />
        </div>
      ) : (
        <ProcessTableArea
          isLg={showSidebar}
          sidebarProportion={sidebarProportion}
          onSidebarResize={setSidebarProportion}
          viewMode={viewMode}
          onKillSingle={(pid, name) => setPendingKill({ pid, name })}
          onKillTree={(pid, name) => setPendingKillTree({ pid, name })}
          onKillGroup={(name, pids) => setGroupKill({ name, pids })}
        />
      )}

      {/* Single-kill confirmation */}
      <ConfirmDialog
        open={pendingKill !== null}
        title="结束进程"
        message={`确定结束 ${pendingKill?.name}（PID ${pendingKill?.pid}）吗？`}
        confirmLabel="结束进程"
        busy={killBusy}
        onConfirm={doKillSingle}
        onCancel={() => { if (!killBusy) setPendingKill(null); }}
      />

      {/* Batch-kill confirmation — targets explicit selected PIDs */}
      <ConfirmDialog
        open={batchKillName !== null}
        title="批量结束进程"
        message={`确定结束选中的 ${selectedPids.size} 个进程吗？${
          batchKillName ? `（主要进程名：${batchKillName}）` : ''
        }`}
        confirmLabel="批量结束"
        busy={killBusy}
        onConfirm={doBatchKill}
        onCancel={() => { if (!killBusy) setBatchKillName(null); }}
      />

      {/* Kill-all-node confirmation — system-wide, guarded by native protection list */}
      <ConfirmDialog
        open={confirmKillAllNode}
        title="结束所有 node.exe"
        message="将结束系统中所有 node.exe 进程（受保护进程如 CodeMgr/electron 会被自动排除）。确定继续吗？"
        confirmLabel="全部结束"
        busy={killBusy}
        onConfirm={doKillAllNode}
        onCancel={() => { if (!killBusy) setConfirmKillAllNode(false); }}
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
        busy={killBusy}
        onConfirm={doKillGroup}
        onCancel={() => { if (!killBusy) setGroupKill(null); }}
      />

      {/* Kill-tree confirmation — native collects all descendants via ppid chain */}
      <ConfirmDialog
        open={pendingKillTree !== null}
        title="结束进程树"
        message={`确定结束 ${pendingKillTree?.name}（PID ${pendingKillTree?.pid}）及其所有子进程吗？`}
        confirmLabel="结束进程树"
        busy={killBusy}
        onConfirm={doKillTree}
        onCancel={() => { if (!killBusy) setPendingKillTree(null); }}
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
      {envDiffPair && (
        <EnvDiffDialog a={envDiffPair.a} b={envDiffPair.b} onClose={() => setEnvDiffPair(null)} />
      )}
    </div>
  );
}

/**
 * 表格 + 可拖宽侧栏的容器。lg+ 屏用 Allotment 分栏（拖动分割条改变比例并持久化），
 * 小屏只渲染表格（侧栏隐藏）。Allotment 的 sizes 是像素，用容器宽度把比例换算成
 * 像素初始化；onChange 时把侧栏像素转回比例存 store。proportionalLayout 默认 true，
 * 窗口缩放时按比例自动跟随。
 */
function ProcessTableArea({
  isLg,
  sidebarProportion,
  onSidebarResize,
  viewMode,
  onKillSingle,
  onKillTree,
  onKillGroup,
}: {
  isLg: boolean;
  sidebarProportion: number;
  onSidebarResize: (p: number) => void;
  viewMode: 'tree' | 'project';
  onKillSingle: (pid: number, name: string) => void;
  onKillTree: (pid: number, name: string) => void;
  onKillGroup: (name: string, pids: number[]) => void;
}) {
  const tableOrGroup = viewMode === 'project' ? (
    <ProjectGroupView
      onKillSingle={onKillSingle}
      onKillGroup={onKillGroup}
      onKillTree={onKillTree}
    />
  ) : (
    <ProcessTable onKillSingle={onKillSingle} onKillTree={onKillTree} />
  );

  // 小屏：无侧栏，直接铺满
  if (!isLg) {
    return <div className="flex min-h-0 flex-1 overflow-hidden">{tableOrGroup}</div>;
  }

  // lg+：Allotment 分栏。用 ResizeObserver 测容器宽度，把 sidebarProportion 换算成
  // 像素作为 defaultSizes（allotment 只在首次生效，之后由 proportionalLayout 按比例保持）。
  // 容器宽度未就绪（0）时不渲染 Allotment，避免 defaultSizes 全 0 的退化布局。
  return (
    <ResizableSplit
      proportion={sidebarProportion}
      onResize={onSidebarResize}
      left={tableOrGroup}
      right={
        <ProcessDetailSidebar
          onKill={onKillSingle}
          onKillTree={onKillTree}
        />
      }
    />
  );
}

/** 测量容器宽度 → 比例换像素初始化 Allotment，onChange 把像素转回比例上报。 */
function ResizableSplit({
  proportion,
  onResize,
  left,
  right,
}: {
  proportion: number;
  onResize: (p: number) => void;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sidebarPx = Math.round(width * proportion);
  // 宽度就绪后挂载一次 Allotment；后续缩放交给 proportionalLayout 保持用户比例。
  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      {width > 0 && (
        <Allotment
          defaultSizes={[width - sidebarPx, sidebarPx]}
          onChange={(sizes) => {
            // sizes = [tablePx, sidebarPx]，total 容差防除零
            const total = sizes[0] + sizes[1];
            if (total > 0) onResize(sizes[1] / total);
          }}
        >
          <Allotment.Pane minSize={200}>{left}</Allotment.Pane>
          <Allotment.Pane minSize={240} preferredSize={sidebarPx}>{right}</Allotment.Pane>
        </Allotment>
      )}
    </div>
  );
}
