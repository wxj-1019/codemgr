import { useProcessPanelStore } from '../store/processPanelStore';
import { formatBytes, formatDuration, formatCpuTime } from '../lib/format';

// 320px 右侧详情栏：展示当前唯一选中进程的"已采集但表格未展示"字段。
// 未选 / 多选 / 进程已退出时显示对应提示。kill 走与表格一致的 onKill 回调
// （由父组件 ProcessPanel 统一弹出 ConfirmDialog），故此组件不直接调 ipc。
export function ProcessDetailSidebar({ onKill }: { onKill: (pid: number, name: string) => void }) {
  const { processes, selectedPids } = useProcessPanelStore();

  if (selectedPids.size === 0) {
    return (
      <aside className="hidden w-80 shrink-0 border-l border-base-600 bg-base-800 p-4 lg:block">
        <p className="text-sm text-fg-muted">选中一个进程查看详情</p>
      </aside>
    );
  }
  if (selectedPids.size > 1) {
    return (
      <aside className="hidden w-80 shrink-0 border-l border-base-600 bg-base-800 p-4 lg:block">
        <p className="text-sm text-fg-muted">已选 {selectedPids.size} 个进程。选择单个查看详情。</p>
      </aside>
    );
  }

  const pid = [...selectedPids][0];
  const proc = processes.find((p) => p.pid === pid);
  if (!proc) {
    return (
      <aside className="hidden w-80 shrink-0 border-l border-base-600 bg-base-800 p-4 lg:block">
        <p className="text-sm text-fg-muted">进程已退出</p>
      </aside>
    );
  }

  const uptimeMs = Date.now() - proc.createTimeMs;
  const cpuTotalMs = proc.kernelTimeMs + proc.userTimeMs;

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(proc!.cmdline);
    } catch { /* clipboard may be blocked */ }
  }

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-base-600 bg-base-800 lg:flex">
      <div className="border-b border-base-600 px-4 py-3">
        <h3 className="text-sm font-semibold text-fg-primary">{proc.name}</h3>
        <p className="text-xs text-fg-muted">PID {proc.pid}</p>
      </div>
      <div className="flex-1 overflow-auto p-4 text-xs">
        <dl className="space-y-2">
          <div>
            <dt className="text-fg-muted">命令行</dt>
            <dd className="mt-0.5 max-h-32 overflow-auto break-all font-mono text-fg-secondary">{proc.cmdline || '—'}</dd>
            {proc.cmdline && (
              <button onClick={copyCmd} className="mt-1 text-accent hover:underline">复制命令行</button>
            )}
          </div>
          <Row label="工作目录" value={proc.cwd || '—'} mono />
          <Row label="父进程 PID" value={String(proc.ppid)} mono />
          <Row label="运行时长" value={formatDuration(uptimeMs)} />
          <Row label="累计 CPU 时间" value={formatCpuTime(cpuTotalMs)} />
          <Row label="内存" value={formatBytes(proc.workingSetBytes)} mono />
          <Row label="线程数" value={String(proc.threadCount)} mono />
          <Row label="句柄数" value={String(proc.handleCount)} mono />
        </dl>
      </div>
      <div className="border-t border-base-600 p-3">
        <button
          onClick={() => onKill(proc.pid, proc.name)}
          className="w-full rounded bg-red-600/80 px-3 py-1.5 text-sm text-white hover:bg-red-500"
        >
          结束进程
        </button>
      </div>
    </aside>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`mt-0.5 text-fg-secondary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
