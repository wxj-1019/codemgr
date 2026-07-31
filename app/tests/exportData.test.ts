import { describe, it, expect } from 'vitest';
import { csvEscape, rowsToCsv, processesToCsv, connectionsToCsv, toPrettyJson, buildExportName } from '../src/lib/exportData';
import type { ProcessInfo, NetConnection } from '../electron/ipc-types';

const proc: ProcessInfo = {
  pid: 100, ppid: 4, name: 'node.exe', cmdline: 'node "my app"', cwd: 'E:\\repo',
  kernelTimeMs: 10, userTimeMs: 20, workingSetBytes: 1024, createTimeMs: new Date('2026-07-31T01:02:03Z').getTime(),
  threadCount: 7, handleCount: 50,
};
const conn: NetConnection = {
  protocol: 'tcp', localAddr: '0.0.0.0', localPort: 3000,
  remoteAddr: '', remotePort: 0, state: 'LISTENING', pid: 100, processName: 'node.exe',
};

describe('csvEscape / rowsToCsv', () => {
  it('含逗号/引号/换行的值双引号包裹且引号双写', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('x\ny')).toBe('"x\ny"');
  });
  it('rowsToCsv 首行表头 + CRLF 行尾', () => {
    const out = rowsToCsv(['a', 'b'], [[1, 2], [3, 4]]);
    expect(out).toBe('a,b\r\n1,2\r\n3,4');
  });
});

describe('processesToCsv / connectionsToCsv', () => {
  it('进程列序正确且 cpu 来自 cpuMap，cmdline 转义', () => {
    const out = processesToCsv([proc], { 100: 12.5 });
    const [header, row] = out.split('\r\n');
    expect(header).toBe('pid,ppid,name,cpu_percent,memory_bytes,threads,cmdline,cwd,create_time_iso');
    expect(row).toBe('100,4,node.exe,12.5,1024,7,"node ""my app""",E:\\repo,2026-07-31T01:02:03.000Z');
  });
  it('端口列序正确', () => {
    const out = connectionsToCsv([conn]);
    expect(out.split('\r\n')[1]).toBe('tcp,0.0.0.0,3000,,0,LISTENING,100,node.exe');
  });
});

describe('toPrettyJson / buildExportName', () => {
  it('JSON 两空格缩进', () => {
    expect(toPrettyJson([{ a: 1 }])).toBe('[\n  {\n    "a": 1\n  }\n]');
  });
  it('文件名带时间戳', () => {
    const name = buildExportName('processes', 'csv', new Date('2026-07-31T06:15:00Z'));
    expect(name).toMatch(/^codemgr-processes-\d{8}-\d{4}\.csv$/);
  });
});
