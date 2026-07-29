import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunProfile, RunState } from './ipc-types';

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

// ── RunManager（main 运行时，非纯函数；封装 spawn/stop/restart + 状态）──

type ExecChild = ReturnType<typeof execFile>;

export class RunManager {
  private runs = new Map<string, { child: ExecChild; state: RunState }>();
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
      child.on('exit', (code) => {
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
