import { useEffect, useMemo, useState, useCallback } from 'react';
import type { SnapshotEntry, ProcessSnapshot } from '../../electron/ipc-types';
import { useSnapshotStore } from '../store/snapshotStore';
import { ipc } from '../lib/ipc';
import { diffSnapshots, type SnapshotDiff } from '../lib/snapshotDiff';
import { groupByProject } from '../lib/projectGroup';
import { ConfirmDialog } from './ConfirmDialog';

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
  { id: 'removed', label: '已退出', color: 'text-fg-muted', dot: 'bg-fg-muted' },
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
      alert('请先输入快照名称（如「agent 开工前」）');
      return;
    }
    setCapturing(true);
    try {
      // 拍快照时刻取当前进程（独立于面板已缓存的 currentEntries，确保是「按下按钮这一刻」的快照）
      const result = await ipc.fetchProcesses();
      if (!result.ok) {
        alert(`取当前进程失败：${result.error.message}`);
        return;
      }
      const entries = result.data.map(toSnapshotEntry);
      const snap = await save(name, entries);
      if (snap) {
        setNameInput('');
        // 拍快照后顺手刷新当前进程缓存，让 diff 立即基于最新态
        setCurrentEntries(entries);
      } else {
        // save 内部已 setError，这里不再重复 alert
      }
    } catch (e) {
      alert(`拍快照失败：${String(e)}`);
    } finally {
      setCapturing(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此快照吗？')) return;
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

  async function doBatchKill() {
    if (killBusy) return;
    setKillBusy(true);
    try {
      const targets = [...selectedPids];
      const killed = await ipc.killByPids(targets);
      setBatchKillName(null);
      clearSelection();
      if (killed === 0) {
        alert('未结束任何进程：可能均为受保护进程、权限不足或已退出');
      } else if (killed < targets.length) {
        alert(`已结束 ${killed}/${targets.length} 个进程（其余受保护/无权限/已退出）`);
      } else {
        alert(`已结束 ${killed} 个进程`);
      }
      // kill 后立即刷新当前进程，让 diff 反映最新态
      await refreshCurrent();
    } catch (e) {
      setBatchKillName(null);
      alert(`批量结束失败：${String(e)}`);
    } finally {
      setKillBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-base-700 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">快照对比</h1>
          <p className="text-xs text-fg-muted">
            {snapshots.length} 个快照
            {loading ? ' · 加载中…' : ''}
            {currentEntries ? ` · 当前 ${currentEntries.length} 个进程` : ''}
          </p>
        </div>
        <button
          onClick={refreshCurrent}
          disabled={refreshing}
          className="rounded-lg border border-base-600 bg-base-800 px-3 py-1 text-xs text-fg-secondary hover:bg-base-700 disabled:opacity-50"
          title="重新读取当前进程列表（不轮询）"
        >
          {refreshing ? '刷新中…' : '↻ 刷新当前'}
        </button>
      </header>

      {(error || currentFetchError) && (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          {error || currentFetchError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 左栏：快照列表 */}
        <aside className="w-64 shrink-0 overflow-auto border-r border-base-700 bg-base-900/50">
          {/* 拍快照 */}
          <div className="border-b border-base-700 p-3">
            <input
              type="text"
              placeholder="快照名称（如 agent 开工前）"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCapture(); }}
              className="mb-2 w-full rounded-lg border border-base-600 bg-base-800 px-2 py-1 text-sm text-fg-primary placeholder-fg-muted outline-none focus:border-accent/50"
            />
            <button
              onClick={handleCapture}
              disabled={capturing}
              className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/80 disabled:opacity-50"
            >
              {capturing ? '拍摄中…' : '📸 拍快照'}
            </button>
            <p className="mt-1.5 text-[10px] text-fg-muted">
              上限 20 个，超出请删旧
            </p>
          </div>

          {/* 快照列表 */}
          <ul className="py-1">
            {snapshots.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-fg-muted">
                暂无快照
              </li>
            )}
            {snapshots.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => select(selectedId === m.id ? null : m.id)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-base-800 ${
                    selectedId === m.id ? 'bg-base-800 border-l-2 border-accent' : ''
                  }`}
                >
                  <span className="truncate text-sm text-fg-primary">{m.name}</span>
                  <span className="text-[10px] text-fg-muted">
                    {formatTime(m.createdAt)} · {m.count} 进程
                  </span>
                </button>
                <div className="px-3 pb-1 text-right">
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="text-[10px] text-danger/80 hover:text-danger"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {/* 主区：diff 三组 */}
        <main className="flex-1 overflow-hidden">
          {!baseSnapshot ? (
            <EmptyState text="从左栏选择一个快照开始对比" />
          ) : !currentEntries ? (
            <EmptyState text="正在读取当前进程…" />
          ) : !diff ? (
            <EmptyState text="计算差异中…" />
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
              baseName={baseSnapshot.name}
            />
          )}
        </main>
      </div>

      {/* 批量结束确认（照 ProcessPanel 模式：targets explicit pids） */}
      <ConfirmDialog
        open={batchKillName !== null}
        title="批量结束进程"
        message={`确定结束新增组中选中的 ${selectedPids.size} 个进程吗？（受保护进程会被自动排除）`}
        confirmLabel="批量结束"
        busy={killBusy}
        onConfirm={doBatchKill}
        onCancel={() => { if (!killBusy) setBatchKillName(null); }}
      />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-fg-muted">
      {text}
    </div>
  );
}

/** diff 主视图：三组 tab + 分组列表。added 组多选 + 批量结束。 */
function DiffView({
  diff, tab, setTab,
  selectedPids, toggleSelect, selectAllAdded, clearSelection,
  onBatchKill, baseName,
}: {
  diff: SnapshotDiff;
  tab: TabId;
  setTab: (t: TabId) => void;
  selectedPids: Set<number>;
  toggleSelect: (pid: number) => void;
  selectAllAdded: () => void;
  clearSelection: () => void;
  onBatchKill: () => void;
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
      <div className="flex items-center gap-1 border-b border-base-700 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors ${
              tab === t.id
                ? 'bg-base-800 text-fg-primary'
                : 'text-fg-muted hover:text-fg-secondary'
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${t.dot}`} />
            <span className={tab === t.id ? t.color : ''}>{t.label}</span>
            <span className="ml-0.5 text-xs text-fg-muted">({counts[t.id]})</span>
          </button>
        ))}
        <div className="ml-auto text-xs text-fg-muted">
          基准：{baseName}
        </div>
      </div>

      {/* added 组多选操作条 */}
      {tab === 'added' && counts.added > 0 && (
        <div className="flex items-center gap-2 border-b border-base-700/50 bg-base-900/30 px-3 py-1.5">
          <button
            onClick={selectAllAdded}
            className="text-xs text-accent hover:underline"
          >
            全选
          </button>
          <button
            onClick={clearSelection}
            className="text-xs text-fg-muted hover:underline"
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
      <div className="flex-1 overflow-auto">
        {tab === 'added' && (
          <EntryGroupList
            entries={diff.added}
            mode="added"
            selectedPids={selectedPids}
            toggleSelect={toggleSelect}
          />
        )}
        {tab === 'removed' && (
          <EntryGroupList entries={diff.removed} mode="removed" />
        )}
        {tab === 'changed' && <ChangedList changed={diff.changed} />}
        {counts[tab] === 0 && (
          <EmptyState text={`无${TABS.find((t) => t.id === tab)?.label ?? ''}项`} />
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
  entries, mode, selectedPids, toggleSelect,
}: {
  entries: SnapshotEntry[];
  mode: 'added' | 'removed';
  selectedPids?: Set<number>;
  toggleSelect?: (pid: number) => void;
}) {
  const groups = useMemo(() => groupSnapshotEntries(entries), [entries]);
  const rowColor = mode === 'added' ? 'text-danger' : 'text-fg-muted';

  return (
    <div className="py-1">
      {groups.map((g) => (
        <div key={g.name + (g.dir ?? '')} className="border-b border-base-700/40">
          <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-fg-secondary">
            <span>{g.dir ? '📁' : '📦'}</span>
            <span className="truncate">{g.name}</span>
            <span className="text-fg-muted">({g.pids.length} · {formatMem(g.totalMemory)})</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {entries
                .filter((e) => g.pids.includes(e.pid))
                .map((e) => {
                  const sel = selectedPids?.has(e.pid) ?? false;
                  return (
                    <tr key={`${e.pid}:${e.createTimeMs}`} className="border-t border-base-700/20 hover:bg-base-800/40">
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
                      <td className="px-2 py-1 text-right font-mono text-xs text-fg-secondary">
                        {formatMem(e.workingSetBytes)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-xs text-fg-muted">
                        {e.pid}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-fg-muted truncate max-w-[300px]" title={e.cmdline}>
                        {e.cmdline || '—'}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
      {entries.length === 0 && <EmptyState text={`无${mode === 'added' ? '新增' : '已退出'}进程`} />}
    </div>
  );
}

/** changed 组：before/after 对比表。 */
function ChangedList({ changed }: { changed: SnapshotDiff['changed'] }) {
  return (
    <div className="py-1">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-base-800 text-left text-xs uppercase text-fg-muted">
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
              <tr key={`${c.after.pid}-${d.field}-${i}`} className="border-t border-base-700/20 hover:bg-base-800/40">
                {i === 0 ? (
                  <td className="px-3 py-1 align-top font-mono text-xs text-warn" rowSpan={diffs.length}>
                    {c.after.pid}
                  </td>
                ) : null}
                <td className="px-3 py-1 text-xs text-warn">{d.field}</td>
                <td className="px-3 py-1 font-mono text-xs text-fg-muted">{d.before}</td>
                <td className="px-3 py-1 font-mono text-xs text-warn">{d.after}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
      {changed.length === 0 && <EmptyState text="无变化的进程" />}
    </div>
  );
}
