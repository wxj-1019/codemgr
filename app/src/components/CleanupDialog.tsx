import { useEffect, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { formatBytes } from '../lib/format';
import { scanCleanupCandidates, type CleanupCandidate } from '../lib/cleanupScanner';
import { formatKillFailureSummary, summarizeKillOutcomes } from '../lib/killConfirm';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';
import { useHomeStore } from '../store/homeStore';
import { useProcessPanelStore } from '../store/processPanelStore';

interface CleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 一键优化确认对话框（spec §3.2）：打开瞬间从 stores 取一次快照解析候选
 * （不随 2s 轮询重算），清单默认全选，确认后逐 pid killByPids 并 toast 反馈。
 * 安全边界：仅列检测引擎目标与大内存进程，最终保护由 native IsProtected 兜底。
 */
export function CleanupDialog({ open, onOpenChange }: CleanupDialogProps) {
  const [candidates, setCandidates] = useState<CleanupCandidate[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  // open 翻转为 true 时快照一次（打开瞬间的数据），关闭期间不重算
  useEffect(() => {
    if (!open) return;
    const ps = useProcessPanelStore.getState();
    const list = scanCleanupCandidates({
      processes: ps.processes,
      cpuMap: ps.cpuMap,
      issues: useHomeStore.getState().issues,
    });
    setCandidates(list);
    setChecked(new Set(list.map((c) => c.pid)));
  }, [open]);

  const checkedCount = checked.size;

  const toggle = (pid: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  async function doCleanup() {
    if (busy || checkedCount === 0) return;
    setBusy(true);
    try {
      const targets = [...checked];
      const outcomes = await ipc.killByPids(targets);
      const s = summarizeKillOutcomes(outcomes);
      if (s.killed === 0) {
        notify.error(`未清理任何进程：${formatKillFailureSummary(s) || '全部失败'}`);
      } else if (s.killed < targets.length) {
        notify.warning(`已清理 ${s.killed}/${targets.length} 个进程（${formatKillFailureSummary(s)}）`);
      } else {
        notify.success(`已清理 ${s.killed} 个进程`);
      }
      onOpenChange(false);
    } catch (e) {
      notify.error(`清理失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="一键优化"
      description="清理检测异常与大内存占用的进程"
      busy={busy}
    >
      {candidates.length === 0 ? (
        <div className="py-2 text-sm text-content-secondary">暂无可清理进程</div>
      ) : (
        <ul className="max-h-56 overflow-auto rounded-lg border border-line">
          {candidates.map((c) => (
            <li key={c.pid} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0">
              <input
                type="checkbox"
                checked={checked.has(c.pid)}
                onChange={() => toggle(c.pid)}
                disabled={busy}
                aria-label={`选择 ${c.name}（PID ${c.pid}）`}
                className="h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1 truncate text-content-primary">{c.name}</span>
              <span className="shrink-0 font-mono text-xs text-content-secondary">PID {c.pid}</span>
              <span className="shrink-0 font-mono text-xs text-content-secondary">CPU {Math.round(c.cpuPercent)}%</span>
              <span className="shrink-0 font-mono text-xs text-content-secondary">{formatBytes(c.memoryBytes)}</span>
              {c.reason === 'issue-target'
                ? <Badge tone="warning">检测异常</Badge>
                : <Badge tone="neutral">大内存</Badge>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-content-secondary">将结束 {checkedCount} 个进程</span>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            variant="dangerQuiet"
            size="md"
            onClick={doCleanup}
            busy={busy}
            busyLabel="清理中…"
            disabled={checkedCount === 0}
          >
            确认清理
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
