import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunProfile, RunState, RunLogLine, RunLogChunk } from './ipc-types';

/** 允许的可执行名白名单（F1 安全模型）。spawn 用 execFile 无 shell，args 数组传。 */
export const RUN_COMMAND_WHITELIST: ReadonlySet<string> = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'py', 'git',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验 profile schema（F1 安全核心）。非白名单 command / 非绝对 cwd / 坏 args → null。
 * 纯函数，无副作用，可 TDD。
 */
export function validateProfile(x: unknown): RunProfile | null {
  if (x == null || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return null;
  if (typeof o.name !== 'string' || o.name.trim() === '') return null;
  if (typeof o.command !== 'string' || !RUN_COMMAND_WHITELIST.has(o.command)) return null;
  if (!Array.isArray(o.args) || o.args.some((a) => typeof a !== 'string')) return null;
  if (typeof o.cwd !== 'string' || !path.isAbsolute(o.cwd)) return null;
  const profile: RunProfile = {
    id: o.id,
    name: o.name,
    command: o.command,
    args: o.args as string[],
    cwd: o.cwd,
  };
  if (Array.isArray(o.expectedPorts) && o.expectedPorts.every((p) => typeof p === 'number')) {
    profile.expectedPorts = o.expectedPorts as number[];
  }
  return profile;
}

// ── Run 日志 ring buffer（子项目 C，纯函数可 TDD）──
// 每 run 一个 buffer：stdout/stderr 合流按到达顺序入队，2000 行上限丢最老。
export const MAX_LOG_LINES = 2000;

export interface LogBuffer {
  lines: RunLogLine[];
  nextSeq: number;      // 下一个待分配 seq（已分配最大 = nextSeq-1）
  droppedBefore: number;
  pending: string;      // 未换行的半截行，下一块拼合或退出时 flush
}

/** 剥离 ANSI 转义（CSI + OSC），日志纯文本显示（v1 不渲染颜色）。 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '');
}

export function createLogBuffer(): LogBuffer {
  return { lines: [], nextSeq: 1, droppedBefore: 0, pending: '' };
}

function pushLine(buf: LogBuffer, text: string): void {
  buf.lines.push({ seq: buf.nextSeq++, text });
  if (buf.lines.length > MAX_LOG_LINES) { buf.lines.shift(); buf.droppedBefore++; }
}

export function appendLogChunk(buf: LogBuffer, chunk: string): void {
  // \r\n 作为一个分隔处理；单独 \r（进度条覆盖写）也当换行，降级为多行纯文本
  const parts = (buf.pending + chunk).split(/\r\n|\n|\r/);
  buf.pending = parts.pop() ?? '';
  for (const raw of parts) {
    const text = stripAnsi(raw);
    if (raw !== '' && text === '') continue; // 纯控制序列行丢弃
    pushLine(buf, text);
  }
}

/** 进程退出时调用：未换行的尾部落为最后一行。 */
export function flushLog(buf: LogBuffer): void {
  const text = stripAnsi(buf.pending);
  buf.pending = '';
  if (text !== '') pushLine(buf, text);
}

/** 增量读取：只返 seq > sinceSeq 的行；nextSeq = 已分配最大 seq（空 buffer 为 0）。 */
export function readLog(buf: LogBuffer, sinceSeq: number): RunLogChunk {
  return {
    lines: buf.lines.filter((l) => l.seq > sinceSeq),
    droppedBefore: buf.droppedBefore,
    nextSeq: buf.nextSeq - 1,
  };
}

// ── RunManager（main 运行时，非纯函数；封装 spawn/stop/restart + 状态）──

type ExecChild = ReturnType<typeof execFile>;

export class RunManager {
  private runs = new Map<string, { child: ExecChild; state: RunState }>();
  private logs = new Map<string, LogBuffer>();
  private native: { killTree: (pid: number) => number };
  private onUpdate: (state: RunState) => void;

  constructor(native: { killTree: (pid: number) => number }, onUpdate: (state: RunState) => void) {
    this.native = native;
    this.onUpdate = onUpdate;
  }

  start(profile: RunProfile): { runId: string; pid: number } | null {
    try {
      const runId = randomUUID();
      const child = execFile(profile.command, profile.args, {
        cwd: profile.cwd,
        shell: false,           // 关键：不经 shell，args 数组直接传，无注入面
        windowsHide: false,
      });
      const pid = child.pid!;
      const state: RunState = {
        runId, profileId: profile.id, pid, status: 'running', exitCode: null, startedAt: Date.now(),
      };
      this.runs.set(runId, { child, state });
      // 日志捕获（子项目 C）：stdout/stderr 合流进 ring buffer；退出时 flush 半截行
      const buf = createLogBuffer();
      this.logs.set(runId, buf);
      const onData = (chunk: Buffer | string) => appendLogChunk(buf, String(chunk));
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('exit', (code) => {
        flushLog(buf);
        const r = this.runs.get(runId);
        if (r) {
          r.state.status = 'exited';
          r.state.exitCode = code;
          this.onUpdate(r.state);
        }
      });
      return { runId, pid };
    } catch (e) {
      console.error('RunManager.start failed:', e);
      return null;
    }
  }

  /** 增量读日志；未知 runId → null（渲染层据此提示「日志不可用」）。 */
  getLogs(runId: string, sinceSeq = 0): RunLogChunk | null {
    const buf = this.logs.get(runId);
    return buf ? readLog(buf, sinceSeq) : null;
  }

  stop(runId: string): number {
    const r = this.runs.get(runId);
    if (!r || r.state.status !== 'running') return 0;
    return this.native.killTree(r.state.pid);  // 复用 native killTree（过保护名单 + 收集后代）
  }

  restart(profile: RunProfile, runId: string): { runId: string; pid: number } | null {
    this.stop(runId);
    return this.start(profile);
  }

  getState(runId: string): RunState | null {
    return this.runs.get(runId)?.state ?? null;
  }

  allStates(): RunState[] {
    return [...this.runs.values()].map((r) => r.state);
  }
}

// ── profile 文件 IO（main 侧，仿 plugins.json）──

export function readProfiles(file: string): RunProfile[] {
  try {
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(validateProfile).filter((p): p is RunProfile => p !== null);
  } catch {
    return [];
  }
}

export function writeProfiles(file: string, profiles: RunProfile[]): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(profiles, null, 2), 'utf8');
}
