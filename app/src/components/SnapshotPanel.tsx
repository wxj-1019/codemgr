import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { SnapshotEntry, SnapshotMeta, ProcessSnapshot } from '../../electron/ipc-types';
import { useSnapshotStore } from '../store/snapshotStore';
import { useFocusStore } from '../store/focusStore';
import { useLayoutStore, containsPanel } from '../store/layoutStore';
import { useNotice } from '../hooks/useNotice';
import { ipc } from '../lib/ipc';
import { formatKillTargets, summarizeKillOutcomes, formatKillFailureSummary } from '../lib/killConfirm';
import { FolderIcon, PackageIcon, Camera, RefreshCw, Trash2 } from './icons';
import { diffSnapshots, type SnapshotDiff } from '../lib/snapshotDiff';
import { groupByProject } from '../lib/projectGroup';
import { ConfirmDialog } from './ConfirmDialog';
import { PanelActionBar } from './ui/PanelActionBar';
import { PanelAlert } from './ui/PanelAlert';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import { StateView } from './ui/StateView';
import { useContainerWidth } from '../hooks/useContainerWidth';

/**
 * 进程快照对比面板（v2.2，spec §2.4）。
 *
 * 布局：
 *  - 左栏：快照列表（拍快照按钮 + 命名输入 + 删除按钮）
 *  - 主区：选中快照 → 与当前对比（diffSnapshots 出 added/removed/changed 三组 tab）
 *
 * 关键约束（spec §2.4）：
 *  - 不加轮询 interval（避免第 4 个轮询器）。当前进程按需取一次 + 手动刷新按钮。
 *  - added 组支持多选 + 「结束选中」（killByPids + ConfirmDialog，照 ProcessPanel）。
 *  - added/removed 按项目分组（复用 groupByProject；SnapshotEntry 字段兼容 ProcessInfo
 *    所需子集，靠 duck-typing 直接传）。
 */

const TABS = [
  { id: 'added', label: '新增', color: 'text-danger', dot: 'bg-danger' },
  { id: 'removed', label: '已退出', color: 'text-content-muted', dot: 'bg-content-muted' },
  { id: 'changed', label: '有变化', color: 'text-warn', dot: 'bg-warn' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** ProcessInfo → SnapshotEntry 子集映射。只取快照需要的字段。 */
function toSnapshotEntry(p: {
  pid: number;
  createTimeMs: number;
  name: string;
  cmdline: string;
  cwd: string;
  workingSetBytes: number;
}): SnapshotEntry {
  return {
    pid: p.pid,
    createTimeMs: p.createTimeMs,
    name: p.name,
    cmdline: p.cmdline,
    cwd: p.cwd,
    workingSetBytes: p.workingSetBytes,
  };
}

function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) + ' MB' : mb.toFixed(1) + ' MB';
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SnapshotPanel() {
  const {
    snapshots, selectedId, loading, error,
    fetchList, save, remove, select,
  } = useSnapshotStore();

  // 命名输入 + 拍快照进行中
  const [nameInput, setNameInput] = useState('');
  const [capturing, setCapturing] = useState(false);

  // 当前进程快照（按需取，不入 store——数百条每秒级刷新不需要跨组件共享）
  const [currentEntries, setCurrentEntries] = useState<SnapshotEntry[] | null>(null);
  const [currentFetchError, setCurrentFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 选中的快照完整数据（按需 loadSnapshot 拉）
  const [baseSnapshot, setBaseSnapshot] = useState<ProcessSnapshot | null>(null);

  // diff tab（默认 added——清理残留的主场景）
  const [tab, setTab] = useState<TabId>('added');

  // added 组多选 pids（spec §2.4：added 支持多选 + 批量结束）
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());
  const [batchKillName, setBatchKillName] = useState<string | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(panelRef);
  const compact = containerWidth !== null && containerWidth < 480;
  // 操作结果反馈横幅（UX-17）：取代原生 alert，自动消失
  const { notice, show: showNotice } = useNotice();

  // 挂载时拉一次列表
  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 拉当前进程（按需，不轮询）。失败降级为 error 提示，不阻塞 diff（currentEntries=null
  // 时显示「请先取当前进程」占位）。
  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    setCurrentFetchError(null);
    try {
      const result = await ipc.fetchProcesses();
      if (result.ok) {
        setCurrentEntries(result.data.map(toSnapshotEntry));
      } else {
        setCurrentFetchError(result.error.message);
      }
    } catch (e) {
      setCurrentFetchError(String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 面板可见时取一次当前进程（spec §2.4：面板可见按需取一次，手动刷新重取）。
  // 注意：不加 interval——避免第 4 个轮询器。
  useEffect(() => {
    refreshCurrent();
  }, [refreshCurrent]);

  // 选中变化时按需 load 完整快照。selectedId 可能来自 persist（重启恢复），此 effect
  // 也会把对应快照内容拉回来。
  useEffect(() => {
    if (!selectedId) {
      setBaseSnapshot(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const snap = await ipc.loadSnapshot(selectedId);
      if (!cancelled) setBaseSnapshot(snap);
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // diff：base = 选中快照 entries，current = 当前进程。两者就绪才算有效。
  const diff: SnapshotDiff | null = useMemo(() => {
    if (!baseSnapshot || !currentEntries) return null;
    return diffSnapshots(baseSnapshot.entries, currentEntries);
  }, [baseSnapshot, currentEntries]);

  // 切换快照时清空多选（防上一组的选择残留到下一组）
  useEffect(() => { setSelectedPids(new Set()); }, [selectedId]);

  async function handleCapture() {
    if (capturing) return;
    const name = nameInput.trim();
    if (!name) {
      showNotice('danger', '请先输入快照名称（如「agent 开工前」）');
      return;
    }
    setCapturing(true);
    try {
      // 拍快照时刻取当前进程（独立于面板已缓存的 currentEntries，确保是「按下按钮这一刻」的快照）
      const result = await ipc.fetchProcesses();
      if (!result.ok) {
        showNotice('danger', `取当前进程失败：${result.error.message}`);
        return;
      }
      const entries = result.data.map(toSnapshotEntry);
      const snap = await save(name, entries);
      if (snap) {
        setNameInput('');
        // 拍快照后顺手刷新当前进程缓存，让 diff 立即基于最新态
        setCurrentEntries(entries);
      } else {
        // save 内部已 setError，这里不再重复提示
      }
    } catch (e) {
      showNotice('danger', `拍快照失败：${String(e)}`);
    } finally {
      setCapturing(false);
    }
  }

  async function handleDelete() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    await remove(id);
  }

  function toggleSelect(pid: number) {
    setSelectedPids((s) => {
      const next = new Set(s);
      next.has(pid) ? next.delete(pid) : next.add(pid);
      return next;
    });
  }

  function selectAllAdded() {
    if (!diff) return;
    setSelectedPids(new Set(diff.added.map((e) => e.pid)));
  }

  function clearSelection() {
    setSelectedPids(new Set());
  }

  // UX-24：定位前检查进程面板是否在布局中，不在则自动打开——避免"点了没反应"
  function locateProcess(pid: number) {
    useFocusStore.getState().focus(pid, 'snapshot');
    const { root } = useLayoutStore.getState();
    if (!containsPanel(root, 'process')) {
      useLayoutStore.getState().openPanel('process');
    }
  }

  async function doBatchKill() {
    if (killBusy) return;
    setKillBusy(true);
    try {
      const targets = [...selectedPids];
      const outcomes = await ipc.killByPids(targets);
      const s = summarizeKillOutcomes(outcomes);
      setBatchKillName(null);
      clearSelection();
      if (s.killed === 0) {
        showNotice('danger', `未结束任何进程：${formatKillFailureSummary(s) || '全部失败'}`);
      } else if (s.killed < targets.length) {
        showNotice('warning', `已结束 ${s.killed}/${targets.length} 个进程（${formatKillFailureSummary(s)}）`);
      } else {
        showNotice('success', `已结束 ${s.killed} 个进程`);
      }
      // kill 后立即刷新当前进程，让 diff 反映最新态
      await refreshCurrent();
    } catch (e) {
      setBatchKillName(null);
      showNotice('danger', `批量结束失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  return (
    <div ref={panelRef} className="flex h-full flex-col">
      <PanelActionBar
        label="快照对比"
        summary={`${snapshots.length} 个快照${loading ? ' · 加载中…' : ''}${currentEntries ? ` · 当前 ${currentEntries.length} 个进程` : ''}`}
        actions={
          <IconButton
            label="刷新当前进程列表"
            size="sm"
            variant="secondary"
            onClick={refreshCurrent}
            disabled={refreshing}
            title="重新读取当前进程列表（不轮询）"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </IconButton>
        }
      />

      {(error || currentFetchError) && (
        <div className="border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error || currentFetchError}
        </div>
      )}

      {notice && <PanelAlert tone={notice.tone}>{notice.text}</PanelAlert>}

      <div className={`flex min-h-0 flex-1 overflow-hidden ${compact ? 'flex-col' : ''}`}>
        {compact ? (
          <CompactSnapshotControls
            snapshots={snapshots}
            selectedId={selectedId}
            nameInput={nameInput}
            capturing={capturing}
            onNameChange={setNameInput}
            onSelect={select}
            onCapture={handleCapture}
            onDelete={() => selectedId && setPendingDeleteId(selectedId)}
          />
        ) : (
          <SnapshotSidebar
            snapshots={snapshots}
            selectedId={selectedId}
            nameInput={nameInput}
            capturing={capturing}
            onNameChange={setNameInput}
            onSelect={select}
            onCapture={handleCapture}
            onDelete={setPendingDeleteId}
          />
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {!baseSnapshot ? (
            <StateView
              className="h-full"
              state="empty"
              title={snapshots.length === 0 ? '暂无快照' : '选择一个快照开始对比'}
              description={snapshots.length === 0 ? '创建快照后，可查看进程的新增、退出和变化。' : undefined}
            />
          ) : !currentEntries ? (
            <StateView className="h-full" state="loading" title="正在读取当前进程" />
          ) : !diff ? (
            <StateView className="h-full" state="loading" title="正在计算差异" />
          ) : (
            <DiffView
              diff={diff}
              tab={tab}
              setTab={setTab}
              selectedPids={selectedPids}
              toggleSelect={toggleSelect}
              selectAllAdded={selectAllAdded}
              clearSelection={clearSelection}
              onBatchKill={() => setBatchKillName('selected')}
              onLocate={locateProcess}
              baseName={baseSnapshot.name}
            />
          )}
        </main>
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="删除快照"
        message="确定删除此快照吗？此操作无法撤销。"
        confirmLabel="删除快照"
        busy={loading}
        onConfirm={handleDelete}
        onCancel={() => { if (!loading) setPendingDeleteId(null); }}
      />

      {/* 批量结束确认（照 ProcessPanel 模式：targets explicit pids；details 列出目标，UX-01） */}
      <ConfirmDialog
        open={batchKillName !== null}
        title="批量结束进程"
        message={`确定结束新增组中选中的 ${selectedPids.size} 个进程吗？（受保护进程会被自动排除）`}
        details={
          diff
            ? formatKillTargets(
                [...selectedPids],
                (pid) => diff.added.find((e) => e.pid === pid)?.name ?? '',
              ).join('\n')
            : ''
        }
        confirmLabel="批量结束"
        busy={killBusy}
        onConfirm={doBatchKill}
        onCancel={() => { if (!killBusy) setBatchKillName(null); }}
      />
    </div>
  );
}

interface SnapshotControlsProps {
  snapshots: SnapshotMeta[];
  selectedId: string | null;
  nameInput: string;
  capturing: boolean;
  onNameChange: (value: string) => void;
  onSelect: (id: string | null) => void;
  onCapture: () => void;
}

function CompactSnapshotControls({
  snapshots,
  selectedId,
  nameInput,
  capturing,
  onNameChange,
  onSelect,
  onCapture,
  onDelete,
}: SnapshotControlsProps & { onDelete: () => void }) {
  return (
    <section data-testid="snapshot-compact-controls" aria-label="快照选择与创建" className="shrink-0 space-y-1.5 border-b border-line bg-surface-raised/70 p-2">
      <div className="flex min-w-0 items-center gap-1">
        <select
          aria-label="对比快照"
          value={selectedId ?? ''}
          onChange={(event) => onSelect(event.target.value || null)}
          className="h-7 min-w-0 flex-1 rounded-lg border border-line bg-surface-overlay px-2 text-xs text-content-primary outline-none focus:ring-2 focus:ring-focus/70"
        >
          <option value="">选择快照</option>
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>{snapshot.name}</option>
          ))}
        </select>
        <IconButton label="删除选中快照" size="sm" variant="dangerQuiet" disabled={!selectedId} onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <input
          type="text"
          aria-label="快照名称"
          placeholder="新快照名称"
          value={nameInput}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onCapture(); }}
          className="h-7 min-w-0 flex-1 rounded-lg border border-line bg-surface-overlay px-2 text-xs text-content-primary placeholder-content-muted outline-none focus:ring-2 focus:ring-focus/70"
        />
        <IconButton label={capturing ? '正在拍摄快照' : '拍快照'} size="sm" variant="primary" disabled={capturing} onClick={onCapture}>
          <Camera size={14} aria-hidden="true" />
        </IconButton>
      </div>
    </section>
  );
}

function SnapshotSidebar({
  snapshots,
  selectedId,
  nameInput,
  capturing,
  onNameChange,
  onSelect,
  onCapture,
  onDelete,
}: SnapshotControlsProps & { onDelete: (id: string) => void }) {
  return (
    <aside data-testid="snapshot-sidebar" className="w-64 shrink-0 overflow-auto border-r border-line bg-surface-raised/60">
      <div className="border-b border-line p-3">
        <input
          type="text"
          aria-label="快照名称"
          placeholder="快照名称（如 agent 开工前）"
          value={nameInput}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onCapture(); }}
          className="mb-2 w-full rounded-lg border border-line bg-surface-overlay px-2 py-1 text-sm text-content-primary placeholder-content-muted outline-none focus:ring-2 focus:ring-focus/70"
        />
        <Button className="w-full" variant="primary" size="sm" busy={capturing} busyLabel="拍摄中" onClick={onCapture}>
          <Camera size={14} aria-hidden="true" />
          拍快照
        </Button>
        <p className="mt-1.5 text-[10px] text-content-muted">最多保留 20 个快照</p>
      </div>

      {snapshots.length === 0 ? (
        <StateView className="min-h-28 px-3 py-5" state="empty" title="暂无快照" />
      ) : (
        <ul className="py-1">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="group flex min-w-0 items-center border-l-2 border-transparent pr-1 data-[selected=true]:border-accent data-[selected=true]:bg-surface-overlay" data-selected={selectedId === snapshot.id}>
              <button
                onClick={() => onSelect(selectedId === snapshot.id ? null : snapshot.id)}
                className="min-w-0 flex-1 px-2 py-2 text-left hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/70"
              >
                <span className="block truncate text-sm text-content-primary">{snapshot.name}</span>
                <span className="block truncate text-[10px] text-content-muted">{formatTime(snapshot.createdAt)} · {snapshot.count} 进程</span>
              </button>
              <IconButton label={`删除快照 ${snapshot.name}`} size="xs" variant="ghost" className="shrink-0 text-content-muted hover:text-danger" onClick={() => onDelete(snapshot.id)}>
                <Trash2 size={13} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** diff 主视图：三组 tab + 分组列表。added 组多选 + 批量结束。 */
function DiffView({
  diff, tab, setTab,
  selectedPids, toggleSelect, selectAllAdded, clearSelection,
  onBatchKill, onLocate, baseName,
}: {
  diff: SnapshotDiff;
  tab: TabId;
  setTab: (t: TabId) => void;
  selectedPids: Set<number>;
  toggleSelect: (pid: number) => void;
  selectAllAdded: () => void;
  clearSelection: () => void;
  onBatchKill: () => void;
  onLocate: (pid: number) => void;
  baseName: string;
}) {
  const counts = {
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab 栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <div role="tablist" aria-label="快照差异类型" className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 ${
                tab === t.id
                  ? 'bg-surface-overlay text-content-primary'
                  : 'text-content-muted hover:bg-surface-raised hover:text-content-secondary'
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
              <span className={tab === t.id ? t.color : ''}>{t.label}</span>
              <span className="text-content-muted">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 truncate text-right text-[11px] text-content-muted" title={`基准：${baseName}`}>
          基准：{baseName}
        </div>
      </div>

      {/* added 组多选操作条 */}
      {tab === 'added' && counts.added > 0 && (
        <div className="flex items-center gap-2 border-b border-line/50 bg-surface-canvas/30 px-3 py-1.5">
          <button
            onClick={selectAllAdded}
            className="text-xs text-accent hover:underline"
          >
            全选
          </button>
          <button
            onClick={clearSelection}
            className="text-xs text-content-muted hover:underline"
          >
            清空
          </button>
          {selectedPids.size > 0 && (
            <button
              onClick={onBatchKill}
              className="btn-danger-quiet ml-auto rounded-lg px-3 py-1 text-xs"
            >
              结束选中 ({selectedPids.size})
            </button>
          )}
        </div>
      )}

      {/* 列表区 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'added' && (
          <EntryGroupList
            entries={diff.added}
            mode="added"
            selectedPids={selectedPids}
            toggleSelect={toggleSelect}
            onLocate={onLocate}
          />
        )}
        {tab === 'removed' && (
          <EntryGroupList entries={diff.removed} mode="removed" />
        )}
        {tab === 'changed' && <ChangedList changed={diff.changed} />}
        {counts[tab] === 0 && (
          <StateView className="h-full" state="empty" title={`无${TABS.find((t) => t.id === tab)?.label ?? ''}项`} />
        )}
      </div>
    </div>
  );
}

/**
 * SnapshotEntry 字段是 groupByProject 所需 ProcessInfo 的子集（pid/cwd/workingSetBytes）。
 * 经 unknown 双重断言喂给 groupByProject——后者只用这三字段，缺 ppid 等不影响分组。
 */
function groupSnapshotEntries(entries: SnapshotEntry[]) {
  return groupByProject(entries as unknown as Parameters<typeof groupByProject>[0]);
}

/** added/removed 分组列表：按项目分组展示（复用 groupByProject）。 */
function EntryGroupList({
  entries, mode, selectedPids, toggleSelect, onLocate,
}: {
  entries: SnapshotEntry[];
  mode: 'added' | 'removed';
  selectedPids?: Set<number>;
  toggleSelect?: (pid: number) => void;
  onLocate?: (pid: number) => void;
}) {
  const groups = useMemo(() => groupSnapshotEntries(entries), [entries]);
  const rowColor = mode === 'added' ? 'text-danger' : 'text-content-muted';

  return (
    <div className="py-1">
      {groups.map((g) => (
        <div key={g.name + (g.dir ?? '')} className="border-b border-line/40">
          <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-content-secondary">
            <span className="text-content-muted">{g.dir ? <FolderIcon /> : <PackageIcon />}</span>
            <span className="truncate">{g.name}</span>
            <span className="text-content-muted">({g.pids.length} · {formatMem(g.totalMemory)})</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {entries
                .filter((e) => g.pids.includes(e.pid))
                .map((e) => {
                  const sel = selectedPids?.has(e.pid) ?? false;
                  return (
                    <tr key={`${e.pid}:${e.createTimeMs}`} className="border-t border-line/20 hover:bg-surface-raised/40">
                      {mode === 'added' && toggleSelect && (
                        <td className="w-8 px-2 py-1">
                          <input
                            type="checkbox"
                            checked={sel}
                            onChange={() => toggleSelect(e.pid)}
                            className="accent-danger"
                          />
                        </td>
                      )}
                      <td className={`px-2 py-1 ${rowColor} truncate max-w-[200px]`} title={e.name}>
                        {e.name}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs text-content-secondary">
                        {formatMem(e.workingSetBytes)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs text-content-muted">
                        {e.pid}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-content-muted truncate max-w-[300px]" title={e.cmdline}>
                        {e.cmdline || '—'}
                      </td>
                      {mode === 'added' && (
                        <td className="w-12 px-2 py-1 text-right">
                          <button
                            onClick={() => onLocate?.(e.pid)}
                            className="text-accent hover:underline text-xs"
                            title="在进程表定位此进程（若仍存活；面板未打开会自动打开）"
                          >
                            定位
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
      {entries.length === 0 && <StateView state="empty" title={`无${mode === 'added' ? '新增' : '已退出'}进程`} />}
    </div>
  );
}

/** changed 组：before/after 对比表。 */
function ChangedList({ changed }: { changed: SnapshotDiff['changed'] }) {
  return (
    <div className="py-1">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-raised text-left text-xs text-content-muted">
          <tr>
            <th className="px-3 py-2 font-medium">PID</th>
            <th className="px-3 py-2 font-medium">字段</th>
            <th className="px-3 py-2 font-medium">快照中（before）</th>
            <th className="px-3 py-2 font-medium">当前（after）</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((c) => {
            const diffs: Array<{ field: string; before: string; after: string }> = [];
            if (c.before.name !== c.after.name) diffs.push({ field: 'name', before: c.before.name, after: c.after.name });
            if (c.before.cmdline !== c.after.cmdline) diffs.push({ field: 'cmdline', before: c.before.cmdline || '—', after: c.after.cmdline || '—' });
            if (c.before.cwd !== c.after.cwd) diffs.push({ field: 'cwd', before: c.before.cwd || '—', after: c.after.cwd || '—' });
            if (c.before.workingSetBytes !== c.after.workingSetBytes) diffs.push({ field: '内存', before: formatMem(c.before.workingSetBytes), after: formatMem(c.after.workingSetBytes) });
            return diffs.map((d, i) => (
              <tr key={`${c.after.pid}-${d.field}-${i}`} className="border-t border-line/20 hover:bg-surface-raised/40">
                {i === 0 ? (
                  <td className="px-3 py-1 align-top font-mono text-xs text-warn" rowSpan={diffs.length}>
                    {c.after.pid}
                  </td>
                ) : null}
                <td className="px-3 py-1 text-xs text-warn">{d.field}</td>
                <td className="px-3 py-1 font-mono text-xs text-content-muted">{d.before}</td>
                <td className="px-3 py-1 font-mono text-xs text-warn">{d.after}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
      {changed.length === 0 && <StateView state="empty" title="无变化的进程" />}
    </div>
  );
}
