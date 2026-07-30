import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { labelForProcess } from '../lib/processLabels';
import { groupByProject } from '../lib/projectGroup';
import { FolderIcon, PackageIcon, FolderOpen, Terminal, Code } from './icons';
import { ipc } from '../lib/ipc';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { IconButton } from './ui/IconButton';
import { buildProcessMenuItems } from '../lib/processMenu';
import { kindColorOf } from '../lib/kindColors';
import { copyText, openTargetOrNotify } from '../lib/shellClient';

const UNGROUPED = '未分组';
// 未分组组展开时，对组内启发式 cwd 为空的进程按需拉精确 cwd（PEB 直读）。
// 分批限流：每批最多 BATCH_SIZE 个并发 IPC + PEB 行走，批间 BATCH_DELAY_MS 间隔，
// 避免 N 个进程瞬时并发造成 main 进程尖刺。
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 50;

interface ProjectGroupViewProps {
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: (name: string, pids: number[]) => void;
  onKillTree: (pid: number, name: string) => void;
}

/** Format working-set bytes as a human-readable MB string. */
function formatMem(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 1000 ? mb.toFixed(0) : mb.toFixed(1);
}

const GroupRow = memo(function GroupRow({
  name,
  dir,
  pids,
  totalMemory,
  procs,
  isExpanded,
  cpuMap,
  onToggle,
  onKillSingle,
  onKillGroup,
  onContextMenuRow,
}: {
  name: string;
  dir: string | null;
  pids: number[];
  totalMemory: number;
  procs: ProcessInfo[];
  isExpanded: boolean;
  cpuMap: Record<number, number>;
  onToggle: () => void;
  onKillSingle: (pid: number, name: string) => void;
  onKillGroup: () => void;
  onContextMenuRow: (e: React.MouseEvent, proc: ProcessInfo) => void;
}) {
  return (
    <>
      <tr className="border-b border-base-700 bg-base-800/60 hover:bg-base-700">
        <td className="px-2 py-2">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-sm font-medium text-fg-primary"
            title={dir || '未分组进程'}
          >
            <span className="w-4 text-xs text-fg-muted">
              {pids.length > 0 ? (isExpanded ? '▾' : '▸') : ''}
            </span>
            <span className="text-fg-muted">{dir ? <FolderIcon /> : <PackageIcon />}</span>
            <span className="truncate max-w-[260px]">{name}</span>
            <span className="ml-1 text-xs font-normal text-fg-muted">
              ({pids.length} 进程 · 合计 {formatMem(totalMemory)})
            </span>
          </button>
        </td>
        <td className="px-2 py-2" />
        <td className="px-2 py-2" />
        <td className="px-2 py-2 text-right font-mono text-fg-secondary">
          {formatMem(totalMemory)}
        </td>
        <td className="px-2 py-2 text-right text-xs text-fg-muted" colSpan={3}>
          {dir || '—'}
        </td>
        <td className="px-2 py-2 text-right">
          <span className="mr-1 inline-flex items-center gap-0.5 align-middle">
            <IconButton label="打开项目文件夹" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrNotify('folder', dir)}><FolderOpen /></IconButton>
            <IconButton label="在项目目录打开终端" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrNotify('terminal', dir)}><Terminal /></IconButton>
            <IconButton label="在编辑器打开项目" size="xs" disabled={!dir} onClick={() => dir && void openTargetOrNotify('editor', dir)}><Code /></IconButton>
          </span>
          <button
            onClick={onKillGroup}
            className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
            title={`结束本组全部 ${pids.length} 个进程`}
          >
            结束本组
          </button>
        </td>
      </tr>
      {isExpanded &&
        procs.map((proc) => {
          const label = labelForProcess(proc.name, proc.cmdline);
          const cpu = cpuMap[proc.pid] || 0;
          return (
            <tr
              key={proc.pid}
              className="border-b border-base-700/30 hover:bg-base-700"
              onContextMenu={(e) => onContextMenuRow(e, proc)}
            >
              <td className="px-2 py-1" />
              <td className="px-2 py-1">
                <div className="flex items-center gap-1" style={{ paddingLeft: 24 }}>
                  <span className="text-fg-primary truncate max-w-[200px]">
                    {proc.name}
                  </span>
                  {label && (
                    <span
                      className={`ml-1 rounded px-1 text-[10px] ${kindColorOf(label.kind)}`}
                    >
                      {label.label}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-2 py-1 text-right font-mono text-fg-primary">
                {cpu.toFixed(1)}
              </td>
              <td className="px-2 py-1 text-right font-mono text-fg-primary">
                {formatMem(proc.workingSetBytes)}
              </td>
              <td className="px-2 py-1 text-right font-mono text-fg-secondary">
                {proc.pid}
              </td>
              <td className="px-2 py-1 text-right font-mono text-fg-secondary">
                {proc.threadCount}
              </td>
              <td
                className="px-2 py-1 font-mono text-fg-muted truncate max-w-[300px] text-xs"
                title={proc.cmdline}
              >
                {proc.cmdline || '—'}
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  onClick={() => onKillSingle(proc.pid, proc.name)}
                  className="btn-danger-quiet rounded-lg px-1.5 py-0.5 text-[10px]"
                >
                  结束
                </button>
              </td>
            </tr>
          );
        })}
    </>
  );
});

export function ProjectGroupView({ onKillSingle, onKillGroup, onKillTree }: ProjectGroupViewProps) {
  const {
    processes,
    cpuMap,
    filter,
    expandedGroups,
    toggleGroup,
    preciseCwdByPid,
    setPreciseCwd,
  } = useProcessPanelStore();

  // Apply the same filter as the tree view (name/cmdline/pid).
  const filtered = useMemo(() => {
    if (!filter.trim()) return processes;
    const q = filter.toLowerCase();
    return processes.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.cmdline.toLowerCase().includes(q) ||
        p.cwd.toLowerCase().includes(q) ||
        String(p.pid).includes(q),
    );
  }, [processes, filter]);

  // 分组键优先用精确 cwd（旁路缓存），缺失回退启发式
  const groups = useMemo(() => groupByProject(filtered, preciseCwdByPid), [filtered, preciseCwdByPid]);

  // 未分组组展开时，对组内启发式 cwd 为空的进程按需拉精确 cwd。
  // 精确值到达后写入 store 缓存，分组重算时这些进程会从「未分组」迁到真实组。
  // 跟踪展开态防陈旧：组收起/组件卸载时丢弃 in-flight 结果。
  const ungroupedExpanded = expandedGroups.has(UNGROUPED);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!ungroupedExpanded) return;
    cancelledRef.current = false;
    // 候选：启发式 cwd 为空 且 尚无精确缓存 的 pid
    const candidates = processes.filter((pr) => !pr.cwd?.trim() && !(pr.pid in preciseCwdByPid));
    if (candidates.length === 0) return;
    let idx = 0;
    const runBatch = async () => {
      while (idx < candidates.length) {
        if (cancelledRef.current) return;
        const batch = candidates.slice(idx, idx + BATCH_SIZE);
        idx += BATCH_SIZE;
        // 并发拉一批，结果分别写缓存（null/失败静默跳过，保持启发式回退）
        await Promise.all(
          batch.map(async (pr) => {
            try {
              const cwd = await ipc.fetchCwd(pr.pid);
              if (cancelledRef.current) return;
              if (cwd) setPreciseCwd(pr.pid, cwd);
            } catch {
              /* 静默：受保护/已退出进程，保持启发式回退 */
            }
          }),
        );
        if (idx < candidates.length && !cancelledRef.current) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    };
    runBatch();
    return () => { cancelledRef.current = true; };
    // processes/pr preciseCwdByPid 快照取本次展开时刻；不监听其变化避免重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ungroupedExpanded, setPreciseCwd]);

  // For inline pid list under each group: map pid -> process.
  const procByPid = useMemo(() => {
    const m = new Map<number, ProcessInfo>();
    for (const p of filtered) m.set(p.pid, p);
    return m;
  }, [filtered]);

  const onToggle = useCallback((name: string) => toggleGroup(name), [toggleGroup]);

  // ── 右键上下文菜单（与 ProcessTable 同构，但项目视图无树信息，结束进程树按 pid>4 放行） ──
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const onContextMenuRow = useCallback((e: React.MouseEvent, proc: ProcessInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, proc });
  }, []);
  // 与 ProcessTable 共用构建器；项目视图无树信息，hasChildren 传 true（按 pid>4 放行）
  const menuItems: ContextMenuItem[] = menu ? buildProcessMenuItems(
    menu.proc,
    { hasChildren: true },
    {
      onOpenTarget: (kind, path) => void openTargetOrNotify(kind, path),
      onCopy: copyText,
      onKillSingle,
      onKillTree,
    },
  ) : [];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-base-800 text-left text-xs uppercase text-fg-muted">
          <tr>
            <th className="px-2 py-2 font-medium">项目 / 名称</th>
            <th className="w-32 px-2 py-2 font-medium">标签</th>
            <th className="w-16 px-2 py-2 font-medium text-right">CPU%</th>
            <th className="w-20 px-2 py-2 font-medium text-right">内存/MB</th>
            <th className="w-16 px-2 py-2 font-medium text-right">PID</th>
            <th className="w-14 px-2 py-2 font-medium text-right">线程</th>
            <th className="px-2 py-2 font-medium">命令行</th>
            <th className="w-20 px-2 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const groupKey = g.dir ?? g.name; // identity 键：规范化 dir（未分组回退 name）
            const procs = g.pids
              .map((pid) => procByPid.get(pid))
              .filter((x): x is ProcessInfo => !!x);
            return (
              <GroupRow
                key={groupKey}
                name={g.name}
                dir={g.dir}
                pids={g.pids}
                totalMemory={g.totalMemory}
                procs={procs}
                isExpanded={expandedGroups.has(groupKey)}
                cpuMap={cpuMap}
                onToggle={() => onToggle(groupKey)}
                onKillSingle={onKillSingle}
                onKillGroup={() => onKillGroup(g.name, g.pids)}
                onContextMenuRow={onContextMenuRow}
              />
            );
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-fg-muted">
                无进程
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
