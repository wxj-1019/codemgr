import { useEffect, useRef, useState } from 'react';
import type { GitIdentity, ProcessInfo } from '../../electron/ipc-types';
import { useProcessPanelStore } from '../store/processPanelStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { useFocusStore } from '../store/focusStore';
import { formatBytes, formatDuration, formatCpuTime } from '../lib/format';
import { MiniChart } from './MiniChart';
import { ipc } from '../lib/ipc';
import { buildDiagnostic } from '../lib/diagnostic';
import { DiagnosticPreview } from './DiagnosticPreview';

// 320px 右侧详情栏：展示当前唯一选中进程的"已采集但表格未展示"字段。
// 未选 / 多选 / 进程已退出时显示对应提示。kill 走与表格一致的 onKill 回调
// （由父组件 ProcessPanel 统一弹出 ConfirmDialog），环境变量读取走 lib/ipc 封装。
export function ProcessDetailSidebar({
  onKill,
  onKillTree,
}: {
  onKill: (pid: number, name: string) => void;
  onKillTree: (pid: number, name: string) => void;
}) {
  const { processes, selectedPids, procHistory, cpuMap, preciseCwdByPid, setPreciseCwd: setStoreCwd,
    gitIdentityByPid, setGitIdentity } = useProcessPanelStore();
  const connections = usePortRadarStore((s) => s.connections);
  const focusedPid = useFocusStore((s) => s.focusedPid);
  // pid 在组件顶部推导：下方有多个条件早退 return，hooks 必须放在它们之前
  // 优先级：单选态 > 全局聚焦。无单选时侧栏跟随全局聚焦（C）。
  const pid = selectedPids.size === 1 ? [...selectedPids][0] : focusedPid;

  // 环境变量：按需加载，切换选中进程时重置（不做轮询，避免高频 ReadProcessMemory）
  const [envVars, setEnvVars] = useState<Record<string, string> | null>(null);
  const [envState, setEnvState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  // 精确 cwd（PEB 直读）：优先复用 store 缓存（与项目分组共享），命中则不重复 IPC；
  // 未命中才按需拉取，结果写回 store 缓存。
  const [preciseCwd, setPreciseCwd] = useState<string | null>(null);
  const [cwdState, setCwdState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  // Git 身份（B，按需）：优先复用 store 缓存，未命中按需拉取。
  // undefined=未解析，null=已解析非 git，GitIdentity=已解析。
  const [gitIdentity, setGitIdentityLocal] = useState<GitIdentity | null | undefined>(undefined);
  const [gitState, setGitState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  // 诊断上下文（D，按需聚合 + 脱敏 + 预览复制）
  const [diagState, setDiagState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [diagText, setDiagText] = useState<string | null>(null);
  useEffect(() => {
    setEnvVars(null);
    setEnvState('idle');
    // 切换选中进程时：store 缓存命中则直接展示（与分组共享同一值），否则回 idle 待拉取
    const cached = pid != null ? preciseCwdByPid[pid] : undefined;
    if (cached) {
      setPreciseCwd(cached);
      setCwdState('done');
    } else {
      setPreciseCwd(null);
      setCwdState('idle');
    }
    // Git 身份：store 缓存命中则展示（含 null=非 git），否则 idle
    const cachedGit = pid != null ? gitIdentityByPid[pid] : undefined;
    if (cachedGit !== undefined) {
      setGitIdentityLocal(cachedGit);
      setGitState('done');
    } else {
      setGitIdentityLocal(undefined);
      setGitState('idle');
    }
  }, [pid, preciseCwdByPid, gitIdentityByPid]);
  // 比对 in-flight 请求是否已陈旧（native 调用不可中断，故不用 AbortController）
  const pidRef = useRef(pid);
  pidRef.current = pid;

  async function loadEnv() {
    if (pid == null) return;
    setEnvState('loading');
    try {
      const result = await ipc.fetchProcessEnv(pid);
      if (pidRef.current !== pid) return; // 选中已切换，丢弃陈旧结果
      if (result === null) {
        setEnvState('error');
      } else {
        setEnvVars(result);
        setEnvState('done');
      }
    } catch {
      if (pidRef.current !== pid) return; // 同上：陈旧请求的 rejection 也丢弃
      setEnvState('error'); // invoke reject（通道缺失/热更新错配）：避免卡在"读取中…"
    }
  }

  async function loadCwd() {
    if (pid == null) return;
    // store 缓存命中：直接展示，不重复 IPC（与项目分组共享同一缓存）
    const cached = preciseCwdByPid[pid];
    if (cached) {
      setPreciseCwd(cached);
      setCwdState('done');
      return;
    }
    setCwdState('loading');
    try {
      const result = await ipc.fetchCwd(pid);
      if (pidRef.current !== pid) return;
      if (result === null) {
        setCwdState('error');
      } else {
        setPreciseCwd(result);
        setStoreCwd(pid, result); // 写回 store 缓存，供项目分组复用
        setCwdState('done');
      }
    } catch {
      if (pidRef.current !== pid) return;
      setCwdState('error');
    }
  }

  async function loadGitIdentity() {
    if (pid == null) return;
    // store 缓存命中（含 null=非 git）：直接展示
    const cached = gitIdentityByPid[pid];
    if (cached !== undefined) {
      setGitIdentityLocal(cached);
      setGitState('done');
      return;
    }
    // 取 cwd：精确优先，回退启发式；空则先级联拉精确 cwd
    const p = processes.find((x) => x.pid === pid);
    let cwd = preciseCwdByPid[pid] ?? p?.cwd ?? '';
    setGitState('loading');
    try {
      if (!cwd) {
        const precise = await ipc.fetchCwd(pid);
        if (pidRef.current !== pid) return;
        cwd = precise ?? '';
        if (cwd) setStoreCwd(pid, cwd);
      }
      if (!cwd) {
        setGitIdentityLocal(null);
        setGitState('done');
        setGitIdentity(pid, null);
        return;
      }
      const identity = await ipc.fetchGitIdentity(cwd);
      if (pidRef.current !== pid) return;
      setGitIdentityLocal(identity);
      setGitState('done');
      setGitIdentity(pid, identity);  // 写回 store 缓存（null 也写，避免重复 IPC）
    } catch {
      if (pidRef.current !== pid) return;
      setGitState('error');
    }
  }

  // 诊断上下文（D）：按需补齐缺失项，聚合脱敏 Markdown，弹预览窗。
  async function copyDiagnostic() {
    if (pid == null) return;
    setDiagState('loading');
    try {
      const p = processes.find((x) => x.pid === pid)!;
      // 按需补齐：精确 cwd
      let cwd: string | null = preciseCwdByPid[pid] ?? null;
      if (!cwd) {
        const precise = await ipc.fetchCwd(pid);
        if (pidRef.current !== pid) return;
        cwd = precise;
        if (cwd) setStoreCwd(pid, cwd);
      }
      // Git 身份
      let git = gitIdentityByPid[pid];
      if (git === undefined && cwd) {
        git = await ipc.fetchGitIdentity(cwd);
        if (pidRef.current !== pid) return;
        setGitIdentity(pid, git);
      }
      // 环境变量
      let env = envVars;
      if (env === null) {
        env = await ipc.fetchProcessEnv(pid);
        if (pidRef.current !== pid) return;
      }
      // 父进程链（3 层）
      const chain: ProcessInfo[] = [];
      let curPpid = p.ppid;
      for (let i = 0; i < 3 && curPpid > 0; i++) {
        const parent = processes.find((x) => x.pid === curPpid);
        if (!parent) break;
        chain.push(parent);
        curPpid = parent.ppid;
      }
      const text = buildDiagnostic({
        proc: p,
        cpuPercent: cpuMap[pid] || 0,
        preciseCwd: cwd,
        gitIdentity: git,
        envVars: env,
        connections,
        parentChain: chain,
        staleAt: null,
        codeMgrVersion: '',
      });
      if (pidRef.current !== pid) return;
      setDiagText(text);
      setDiagState('idle');
    } catch {
      if (pidRef.current !== pid) return;
      setDiagState('error');
    }
  }

  if (selectedPids.size === 0) {
    return (
      <aside className="hidden h-full border-l border-base-600 bg-base-800 p-4 lg:flex lg:items-center lg:justify-center">
        <p className="text-xs text-fg-muted/70">选中一个进程查看详情</p>
      </aside>
    );
  }
  if (selectedPids.size > 1) {
    return (
      <aside className="hidden h-full border-l border-base-600 bg-base-800 p-4 lg:block">
        <p className="text-sm text-fg-muted">已选 {selectedPids.size} 个进程。选择单个查看详情。</p>
      </aside>
    );
  }

  const proc = processes.find((p) => p.pid === pid);
  if (!proc) {
    return (
      <aside className="hidden h-full border-l border-base-600 bg-base-800 p-4 lg:block">
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
    <aside className="hidden h-full flex-col border-l border-base-600 bg-base-800 lg:flex">
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
          <div>
            <dt className="text-fg-muted">
              工作目录
              <span className="ml-1 text-fg-muted/70">(启发式)</span>
            </dt>
            <dd className="mt-0.5 break-all font-mono text-fg-secondary">{proc.cwd || '—'}</dd>
            <div className="mt-1">
              {cwdState === 'idle' && (
                <button onClick={loadCwd} className="text-accent hover:underline">
                  读取精确工作目录
                </button>
              )}
              {cwdState === 'loading' && <span className="text-fg-muted">读取中…</span>}
              {cwdState === 'error' && (
                <span className="text-fg-muted">读取失败：权限不足或进程已退出</span>
              )}
              {cwdState === 'done' && preciseCwd !== null && (
                <dd className="break-all font-mono text-fg-secondary">
                  <span className="text-accent/80">(精确)</span> {preciseCwd || '—'}
                </dd>
              )}
            </div>
          </div>
          <div>
            <dt className="text-fg-muted">Git</dt>
            <dd className="mt-0.5">
              {gitState === 'idle' && (
                <button onClick={loadGitIdentity} className="text-accent hover:underline">
                  解析 Git 身份
                </button>
              )}
              {gitState === 'loading' && <span className="text-fg-muted">解析中…</span>}
              {gitState === 'error' && (
                <span className="text-fg-muted">解析失败</span>
              )}
              {gitState === 'done' && gitIdentity === null && (
                <span className="text-fg-muted">非 Git 仓库</span>
              )}
              {gitState === 'done' && gitIdentity && (
                <div className="space-y-0.5 font-mono text-fg-secondary">
                  <div>
                    {gitIdentity.detached
                      ? `detached @ ${gitIdentity.head.slice(0, 8)}`
                      : gitIdentity.branch}
                    {gitIdentity.isWorktree && (
                      <span className="ml-1 rounded bg-base-700 px-1 text-[10px] text-fg-muted">worktree</span>
                    )}
                  </div>
                  <div className="break-all text-fg-muted text-[11px]">{gitIdentity.gitRoot}</div>
                </div>
              )}
            </dd>
          </div>
          <Row label="父进程 PID" value={String(proc.ppid)} mono />
          <Row label="运行时长" value={formatDuration(uptimeMs)} />
          <Row label="累计 CPU 时间" value={formatCpuTime(cpuTotalMs)} />
          <Row label="内存" value={formatBytes(proc.workingSetBytes)} mono />
          {(procHistory[proc.pid]?.length ?? 0) > 1 && (
            <div className="space-y-1 rounded border border-base-700 bg-base-900 p-2">
              <p className="text-fg-muted">CPU%（近 {procHistory[proc.pid]!.length * 2}s）</p>
              <MiniChart
                data={procHistory[proc.pid]!}
                dataKey="cpu"
                color="var(--accent-data)"
                domain={[0, 100]}
                formatValue={(v) => v.toFixed(1) + '%'}
                idSuffix={`cpu-${proc.pid}`}
              />
              <p className="pt-1 text-fg-muted">内存（近 {procHistory[proc.pid]!.length * 2}s）</p>
              <MiniChart
                data={procHistory[proc.pid]!}
                dataKey="mem"
                color="var(--accent)"
                formatValue={(v) => formatBytes(v)}
                idSuffix={`mem-${proc.pid}`}
              />
            </div>
          )}
          <Row label="线程数" value={String(proc.threadCount)} mono />
          <Row label="句柄数" value={String(proc.handleCount)} mono />
          <div>
            <dt className="text-fg-muted">环境变量</dt>
            <dd className="mt-0.5">
              {envState === 'idle' && (
                <button onClick={loadEnv} className="text-accent hover:underline">
                  加载环境变量
                </button>
              )}
              {envState === 'loading' && <span className="text-fg-muted">读取中…</span>}
              {envState === 'error' && (
                <span className="text-fg-muted">读取失败：权限不足或进程已退出</span>
              )}
              {envState === 'done' && envVars && (
                <div className="max-h-48 overflow-auto rounded border border-base-700 bg-base-900 p-2 font-mono text-[11px]">
                  {Object.keys(envVars).sort().map((k) => (
                    <div key={k} className="break-all">
                      <span className="text-accent">{k}</span>
                      <span className="text-fg-muted">=</span>
                      <span className="text-fg-secondary">{envVars[k]}</span>
                    </div>
                  ))}
                </div>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="border-t border-base-600 p-3">
        <button
          onClick={copyDiagnostic}
          disabled={diagState === 'loading'}
          className="mb-2 w-full rounded border border-base-600 px-3 py-1.5 text-sm text-fg-secondary hover:bg-base-700 disabled:opacity-50"
        >
          {diagState === 'loading' ? '生成中…' : '复制诊断上下文'}
        </button>
        {diagState === 'error' && (
          <p className="mb-2 text-xs text-red-400">生成失败</p>
        )}
        <button
          onClick={() => onKill(proc.pid, proc.name)}
          className="btn-danger-quiet w-full rounded-lg px-3 py-1.5 text-sm"
        >
          结束进程
        </button>
        {proc.pid > 4 && (
          <button
            onClick={() => onKillTree(proc.pid, proc.name)}
            className="btn-danger-quiet mt-2 w-full rounded px-3 py-1.5 text-sm"
          >
            结束进程树
          </button>
        )}
      </div>
      {diagText && <DiagnosticPreview text={diagText} onClose={() => setDiagText(null)} />}
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
