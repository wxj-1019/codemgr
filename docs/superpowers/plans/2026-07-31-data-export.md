# 数据导出（进程/端口 CSV/JSON）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 进程/端口面板一键导出当前过滤视图为 CSV/JSON（main 保存对话框持路径，渲染层只传内容）。

**Architecture:** 通用通道 `config:exportDataFile`（main 校验文件名/大小，返回 ok/cancelled/error）+ 渲染层 `lib/exportData.ts` 序列化纯函数 + 两面板的 Download IconButton + ContextMenu。

**Tech Stack:** Electron dialog、Vitest。

**Spec:** `docs/superpowers/specs/2026-07-31-data-export-design.md`

---

### Task 1: main 侧文件名校验（TDD）

**Files:**
- Create: `app/electron/exportFile.ts`
- Test: `app/tests/exportFile.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeExportName, EXPORT_MAX_CONTENT_BYTES } from '../electron/exportFile';

describe('sanitizeExportName', () => {
  it('合法文件名原样通过', () => {
    expect(sanitizeExportName('codemgr-processes-20260731-0615.csv')).toBe('codemgr-processes-20260731-0615.csv');
    expect(sanitizeExportName('a.json')).toBe('a.json');
  });
  it('路径穿越剥离为 basename', () => {
    expect(sanitizeExportName('..\\..\\evil.csv')).toBe('evil.csv');
    expect(sanitizeExportName('C:/tmp/x.json')).toBe('x.json');
  });
  it('Windows 非法字符替换为下划线', () => {
    expect(sanitizeExportName('a<b>:"|?*.csv')).toBe('a_______.csv');
  });
  it('扩展名白名单外拒绝', () => {
    expect(sanitizeExportName('x.exe')).toBeNull();
    expect(sanitizeExportName('x')).toBeNull();
    expect(sanitizeExportName('x.CSV')).toBe('x.CSV'); // 大小写不敏感放行
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// 导出文件名校验（子项目 E，纯逻辑可 TDD）。红线：渲染层只能建议文件名，main 决定路径。
export const EXPORT_MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10MB 防爆
const ALLOWED_EXT: ReadonlySet<string> = new Set(['.csv', '.json', '.txt', '.log', '.md']);

/** 返回清洗后的安全文件名（basename + 非法字符替换 + 扩展名白名单）；不合法 → null。 */
export function sanitizeExportName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[<>:"|?*-\u001f]/g, '_');
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0) return null;
  if (!ALLOWED_EXT.has(cleaned.slice(dot).toLowerCase())) return null;
  return cleaned;
}
```

- [ ] **Step 4: PASS + Commit**

```bash
git add app/electron/exportFile.ts app/tests/exportFile.test.ts
git commit -m "feat(app): export filename validation (basename, illegal chars, ext whitelist)"
```

---

### Task 2: IPC 接线

**Files:**
- Modify: `app/electron/ipc-types.ts`、`app/electron/preload.ts`、`app/electron/main.ts`、`app/src/lib/ipc.ts`

- [ ] **Step 1: ipc-types**

`IPC` 常量（`LIST_PLUGINS` 后）加：

```ts
  // 数据导出（子项目 E）：渲染层传建议文件名+内容，main 保存对话框持路径（红线同 EXPORT_LABEL_RULES）
  EXPORT_DATA_FILE: 'config:exportDataFile',
```

类型区加：

```ts
/** 数据导出结果（子项目 E）：cancelled 用户取消（UI 静默），error 失败。 */
export type ExportDataResult = 'ok' | 'cancelled' | 'error';
```

`ExposedApi` 加：

```ts
  // 数据导出（子项目 E）。文件名/大小 main 校验；内容已由渲染层序列化（CSV/JSON 文本）。
  exportDataFile(defaultName: string, content: string): Promise<ExportDataResult>;
```

- [ ] **Step 2: preload / lib/ipc**

```ts
exportDataFile: (defaultName: string, content: string) => ipcRenderer.invoke(IPC.EXPORT_DATA_FILE, defaultName, content),
```

```ts
exportDataFile: (...a) => invoke('exportDataFile', ...a),
```

- [ ] **Step 3: main.ts**（EXPORT_LABEL_RULES handler 之后）

```ts
// 数据导出（子项目 E）：文件名白名单校验 + 10MB 上限，保存对话框持路径
ipcMain.handle(IPC.EXPORT_DATA_FILE, async (_evt, defaultName: string, content: string): Promise<ExportDataResult> => {
  try {
    const safe = sanitizeExportName(String(defaultName));
    if (!safe || typeof content !== 'string' || content.length > EXPORT_MAX_CONTENT_BYTES) return 'error';
    const ext = safe.slice(safe.lastIndexOf('.') + 1);
    const res = await dialog.showSaveDialog({
      title: '导出数据',
      defaultPath: safe,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return 'cancelled';
    writeFileSync(res.filePath, content, 'utf8');
    return 'ok';
  } catch (e) {
    console.error('exportDataFile failed:', e);
    return 'error';
  }
});
```

import 区加 `import { sanitizeExportName, EXPORT_MAX_CONTENT_BYTES } from './exportFile';`，ipc-types import 加 `type ExportDataResult`。

- [ ] **Step 4: typecheck + Commit**

```bash
git add app/electron/ipc-types.ts app/electron/preload.ts app/electron/main.ts app/src/lib/ipc.ts
git commit -m "feat(app): wire config:exportDataFile IPC channel"
```

---

### Task 3: 渲染层序列化（TDD）

**Files:**
- Create: `app/src/lib/exportData.ts`
- Test: `app/tests/exportData.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// 数据导出序列化（子项目 E，纯逻辑）：CSV/JSON 文本生成 + 导出文件名。
// 内容在渲染层序列化后整体传给 main（config:exportDataFile），渲染层不碰路径（红线）。
import type { ProcessInfo, NetConnection } from '../../electron/ipc-types';

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 首行表头，CRLF 行尾（Excel 兼容）。 */
export function rowsToCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function processesToCsv(procs: ProcessInfo[], cpuMap: Record<number, number>): string {
  return rowsToCsv(
    ['pid', 'ppid', 'name', 'cpu_percent', 'memory_bytes', 'threads', 'cmdline', 'cwd', 'create_time_iso'],
    procs.map((p) => [
      p.pid, p.ppid, p.name, (cpuMap[p.pid] ?? 0).toFixed(1), p.workingSetBytes,
      p.threadCount, p.cmdline, p.cwd, new Date(p.createTimeMs).toISOString(),
    ]),
  );
}

export function connectionsToCsv(conns: NetConnection[]): string {
  return rowsToCsv(
    ['protocol', 'local_addr', 'local_port', 'remote_addr', 'remote_port', 'state', 'pid', 'process_name'],
    conns.map((c) => [c.protocol, c.localAddr, c.localPort, c.remoteAddr, c.remotePort, c.state, c.pid, c.processName]),
  );
}

export function toPrettyJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** codemgr-<base>-YYYYMMDD-HHmm.<ext>（本地时间）。 */
export function buildExportName(base: string, ext: 'csv' | 'json', now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `codemgr-${base}-${stamp}.${ext}`;
}
```

- [ ] **Step 4: PASS + Commit**

```bash
git add app/src/lib/exportData.ts app/tests/exportData.test.ts
git commit -m "feat(app): export serializers (csv escape, process/port rows, timestamped names)"
```

---

### Task 4: 两面板 UI + 收口

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx`
- Modify: `app/src/components/PortRadar.tsx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: PortRadar**

import 加：`import { Download } from './icons';`、`import { ContextMenu } from './ContextMenu';`、`import { processesToCsv as _unused } from '../lib/exportData';`（实际引 `connectionsToCsv, toPrettyJson, buildExportName`）、`import { ipc } from '../lib/ipc';`（已有）。

组件内加：

```tsx
  // 数据导出（子项目 E）：当前过滤视图 → CSV/JSON，main 保存对话框持路径
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);

  async function doExport(format: 'csv' | 'json') {
    const content = format === 'csv' ? connectionsToCsv(visible) : toPrettyJson(visible);
    const res = await ipc.exportDataFile(buildExportName('ports', format), content);
    if (res === 'ok') notify.success('已导出');
    else if (res === 'error') notify.error('导出失败');
  }
```

PanelActionBar actions 区（搜索框后）加：

```tsx
            <IconButton label="导出" size="sm" onClick={(e) => setExportMenu({ x: e.clientX, y: e.clientY })}>
              <Download />
            </IconButton>
```

面板根 div 末尾加：

```tsx
      <ContextMenu
        open={exportMenu !== null}
        x={exportMenu?.x ?? 0}
        y={exportMenu?.y ?? 0}
        items={[
          { label: '导出 CSV', onSelect: () => void doExport('csv') },
          { label: '导出 JSON', onSelect: () => void doExport('json') },
        ]}
        onClose={() => setExportMenu(null)}
      />
```

- [ ] **Step 2: ProcessPanel**

同构：数据源用当前过滤后的进程（`visibleProcesses`：store 的 processes 按 filter 过滤——若过滤逻辑在 ProcessTable 内部，则在 ProcessPanel 复制其过滤谓词到 `lib` 复用；实现时先查 `lib/processFilter` 或 ProcessTable 的过滤方式，优先抽公共函数）+ cpuMap。`buildExportName('processes', format)`。

- [ ] **Step 3: 全量回归 + CHANGELOG**

CHANGELOG `[Unreleased]` 追加：

```markdown
- **数据导出**：进程面板与端口雷达新增「导出」按钮，当前过滤视图可导出 CSV（Excel 兼容 CRLF）或 JSON；文件路径经 main 保存对话框（文件名白名单校验 + 10MB 上限），导出结果 toast 反馈。新增通用 `config:exportDataFile` IPC 通道。
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ProcessPanel.tsx app/src/components/PortRadar.tsx CHANGELOG.md
git commit -m "feat(app): export filtered process/port views to CSV/JSON with save dialog"
```

---

## Self-Review 记录

- Spec §3.1 → Task 1/2；§3.2 → Task 3；§3.3 → Task 4；§4 测试 → Task 1/3。
- 类型一致性：`ExportDataResult` Task 2 定义，Task 4 `res === 'ok'/'error'` 用法一致；`buildExportName(base, ext)` 的 ext 联合类型与 Task 4 调用一致。
- 风险：ProcessPanel 过滤逻辑位置待实现时确认——若过滤在 ProcessTable 内部，抽 `lib/processFilter.ts` 共享（Task 4 Step 2 已注明）。
