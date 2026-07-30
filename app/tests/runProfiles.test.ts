import { describe, it, expect } from 'vitest';
import {
  validateProfile, RUN_COMMAND_WHITELIST, RunManager,
  createLogBuffer, appendLogChunk, flushLog, readLog,
} from '../electron/runProfiles';

const valid = {
  id: '11111111-2222-3333-4444-555555555555',
  name: '前端',
  command: 'pnpm',
  args: ['dev'],
  cwd: 'E:\\repo\\app',
};

describe('RUN_COMMAND_WHITELIST', () => {
  it('contains common dev executables', () => {
    expect(RUN_COMMAND_WHITELIST.has('node')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('pnpm')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('npm')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('python')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('git')).toBe(true);
  });
  it('excludes dangerous executables', () => {
    expect(RUN_COMMAND_WHITELIST.has('calc')).toBe(false);
    expect(RUN_COMMAND_WHITELIST.has('cmd')).toBe(false);
    expect(RUN_COMMAND_WHITELIST.has('powershell')).toBe(false);
  });
});

describe('validateProfile', () => {
  it('accepts a valid profile', () => {
    const p = validateProfile(valid);
    expect(p).not.toBeNull();
    expect(p!.command).toBe('pnpm');
  });

  it('rejects non-whitelist command', () => {
    expect(validateProfile({ ...valid, command: 'calc' })).toBeNull();
  });

  it('rejects relative cwd', () => {
    expect(validateProfile({ ...valid, cwd: 'relative/path' })).toBeNull();
  });

  it('rejects non-array args', () => {
    expect(validateProfile({ ...valid, args: 'dev' as unknown as string[] })).toBeNull();
  });

  it('rejects empty name', () => {
    expect(validateProfile({ ...valid, name: '' })).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateProfile(null)).toBeNull();
    expect(validateProfile('x')).toBeNull();
  });

  it('preserves optional expectedPorts', () => {
    const p = validateProfile({ ...valid, expectedPorts: [5173, 3000] });
    expect(p!.expectedPorts).toEqual([5173, 3000]);
  });
});

describe('log buffer（子项目 C）', () => {
  it('appendLogChunk 按行切分并剥离 ANSI', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'ready in 300ms\n\x1b[32m✓\x1b[39m compiled\n');
    expect(buf.lines.map((l) => l.text)).toEqual(['ready in 300ms', '✓ compiled']);
    expect(buf.lines.map((l) => l.seq)).toEqual([1, 2]);
  });

  it('半截行进 pending，下一块拼合；\\r\\n 不产生空行', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'listen');
    expect(buf.lines).toHaveLength(0);
    appendLogChunk(buf, 'ing on :3000\r\nok\n');
    expect(buf.lines.map((l) => l.text)).toEqual(['listening on :3000', 'ok']);
  });

  it('flushLog 把退出时未换行的尾部落成最后一行', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'a\ntail-without-newline');
    flushLog(buf);
    expect(buf.lines.map((l) => l.text)).toEqual(['a', 'tail-without-newline']);
  });

  it('超 2000 行丢最老并累计 droppedBefore', () => {
    const buf = createLogBuffer();
    for (let i = 1; i <= 2001; i++) appendLogChunk(buf, `line${i}\n`);
    expect(buf.lines).toHaveLength(2000);
    expect(buf.droppedBefore).toBe(1);
    expect(buf.lines[0]!.text).toBe('line2');
  });

  it('readLog 增量：只返 seq>sinceSeq，nextSeq=已分配最大 seq', () => {
    const buf = createLogBuffer();
    appendLogChunk(buf, 'a\nb\nc\n');
    const all = readLog(buf, 0);
    expect(all.lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(all.nextSeq).toBe(3);
    const inc = readLog(buf, all.nextSeq);
    expect(inc.lines).toHaveLength(0);
    appendLogChunk(buf, 'd\n');
    expect(readLog(buf, all.nextSeq).lines.map((l) => l.text)).toEqual(['d']);
  });
});

describe('RunManager 日志捕获（集成）', () => {
  it('捕获 stdout/stderr，退出后仍可读；未知 runId 返回 null', async () => {
    const mgr = new RunManager({ killTree: () => 0 }, () => {});
    const profile = validateProfile({
      id: '11111111-1111-1111-1111-111111111111',
      name: 't', command: 'node',
      args: ['-e', 'console.log("out-line"); console.error("err-line")'],
      cwd: process.cwd(),
    })!;
    const started = mgr.start(profile);
    expect(started).not.toBeNull();
    // 等进程退出（exit 事件驱动，最多 5s 兜底）
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 5000);
      const poll = setInterval(() => {
        if (mgr.getState(started!.runId)?.status === 'exited') {
          clearInterval(poll); clearTimeout(t); resolve();
        }
      }, 20);
    });
    const chunk = mgr.getLogs(started!.runId, 0);
    expect(chunk).not.toBeNull();
    expect(chunk!.lines.map((l) => l.text)).toEqual(['out-line', 'err-line']);
    expect(mgr.getLogs('no-such-run', 0)).toBeNull();
  }, 10000);
});
