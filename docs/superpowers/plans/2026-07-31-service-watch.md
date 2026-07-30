# 服务守望与就绪跳转 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RunProfile 服务状态跃迁主动 toast（就绪 success / 端口冲突 error）+ 就绪行内 Globe 一键开浏览器。

**Architecture:** 纯逻辑 `lib/serviceWatch.ts`（diff 跃迁事件 + browse URL，TDD）+ RunProfilesPanel 集成（prevKindsRef + useEffect diff + 行内 Globe 复用子项目 A 通道）。

**Tech Stack:** React、Vitest。依赖：devService.resolveServiceStatus（F2 已有）、notify（B）、openExternalUrlOrNotify（A）。

**Spec:** `docs/superpowers/specs/2026-07-31-service-watch-design.md`

---

### Task 1: serviceWatch 纯逻辑（TDD）

**Files:**
- Create: `app/src/lib/serviceWatch.ts`
- Test: `app/tests/serviceWatch.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { diffServiceEvents, browseUrlForService } from '../src/lib/serviceWatch';
import type { ServiceStatus } from '../src/lib/devService';

const listening: ServiceStatus = { kind: 'listening', ports: [{ port: 3000, heldBy: 100, conflict: false }] };
const conflict: ServiceStatus = { kind: 'conflict', ports: [{ port: 3000, heldBy: 200, conflict: true }] };
const starting: ServiceStatus = { kind: 'starting', ports: [{ port: 3000, heldBy: null, conflict: false }] };

describe('diffServiceEvents', () => {
  it('kind 不变无事件', () => {
    const prev = new Map([['p1', 'listening']]);
    const next = new Map([['p1', { name: '前端', status: listening }]]);
    expect(diffServiceEvents(prev, next as never)).toHaveLength(0);
  });

  it('→listening 发一次，带就绪端口', () => {
    const prev = new Map([['p1', 'starting']]);
    const next = new Map([['p1', { name: '前端', status: listening }]]);
    const ev = diffServiceEvents(prev as never, next as never);
    expect(ev).toEqual([{ type: 'listening', profileId: 'p1', profileName: '前端', ports: [3000], heldBy: [] }]);
  });

  it('→conflict 发一次，带冲突端口与占用者', () => {
    const prev = new Map([['p1', 'listening']]);
    const next = new Map([['p1', { name: '前端', status: conflict }]]);
    const ev = diffServiceEvents(prev as never, next as never);
    expect(ev).toEqual([{ type: 'conflict', profileId: 'p1', profileName: '前端', ports: [3000], heldBy: [200] }]);
  });

  it('starting/exited/no-ports 不产生事件；新出现 profile 首次就绪也通知', () => {
    expect(diffServiceEvents(new Map(), new Map([['p1', { name: 'x', status: starting }]]) as never)).toHaveLength(0);
    expect(diffServiceEvents(new Map([['p1', 'listening']]), new Map([['p1', { name: 'x', status: { kind: 'exited' } }]]) as never)).toHaveLength(0);
    const ev = diffServiceEvents(new Map(), new Map([['p1', { name: 'x', status: listening }]]) as never);
    expect(ev).toHaveLength(1); // prev 无记录视为跃迁
  });
});

describe('browseUrlForService', () => {
  it('listening 取首个非冲突端口', () => {
    expect(browseUrlForService(listening)).toBe('http://127.0.0.1:3000');
  });
  it('conflict/starting/exited/no-ports → null', () => {
    expect(browseUrlForService(conflict)).toBeNull();
    expect(browseUrlForService(starting)).toBeNull();
    expect(browseUrlForService({ kind: 'exited' })).toBeNull();
    expect(browseUrlForService({ kind: 'no-ports' })).toBeNull();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// 服务守望纯逻辑（子项目 D）：状态跃迁事件 diff + 就绪浏览 URL。
import type { ServiceStatus, ServiceStatusKind } from './devService';

export interface ServiceWatchEvent {
  type: 'listening' | 'conflict';
  profileId: string;
  profileName: string;
  ports: number[];
  heldBy: number[];
}

/** prev/next 按 profileId 比对 kind，仅跃迁产出事件（listening/conflict），其余 kind 静默。 */
export function diffServiceEvents(
  prev: ReadonlyMap<string, ServiceStatusKind>,
  next: ReadonlyMap<string, { name: string; status: ServiceStatus }>,
): ServiceWatchEvent[] {
  const events: ServiceWatchEvent[] = [];
  for (const [profileId, { name, status }] of next) {
    if (prev.get(profileId) === status.kind) continue;
    if (status.kind === 'listening' && status.ports) {
      events.push({ type: 'listening', profileId, profileName: name, ports: status.ports.map((p) => p.port), heldBy: [] });
    } else if (status.kind === 'conflict' && status.ports) {
      const bad = status.ports.filter((p) => p.conflict);
      events.push({
        type: 'conflict', profileId, profileName: name,
        ports: bad.map((p) => p.port),
        heldBy: bad.map((p) => p.heldBy ?? 0).filter((pid) => pid > 0),
      });
    }
  }
  return events;
}

/** 就绪服务的浏览 URL：首个非冲突已监听端口；非 listening → null。 */
export function browseUrlForService(status: ServiceStatus): string | null {
  if (status.kind !== 'listening' || !status.ports) return null;
  const p = status.ports.find((x) => !x.conflict && x.heldBy !== null);
  return p ? `http://127.0.0.1:${p.port}` : null;
}
```

- [ ] **Step 4: PASS + Commit**

```bash
git add app/src/lib/serviceWatch.ts app/tests/serviceWatch.test.ts
git commit -m "feat(app): service watch diff + ready browse url"
```

---

### Task 2: RunProfilesPanel 集成 + 收口

**Files:**
- Modify: `app/src/components/RunProfilesPanel.tsx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 集成**

import 加：`import { useEffect, useRef, useState } from 'react';`（替换现有 useState 行）、`import { diffServiceEvents, browseUrlForService } from '../lib/serviceWatch';`、`import { openExternalUrlOrNotify } from '../lib/shellClient';`、`import { IconButton } from './ui/IconButton';`、`import { Globe } from './icons';`。

组件内（`latestRunOf` 之后）加守望 effect：

```tsx
  // 服务守望（子项目 D）：状态跃迁 toast（就绪/端口冲突），kind 不变不重复
  const prevKindsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, { name: string; status: ReturnType<typeof resolveServiceStatus> }>();
    for (const p of profiles) {
      const run = latestRunOf(p.id);
      if (run) next.set(p.id, { name: p.name, status: resolveServiceStatus(run, p, connections) });
    }
    for (const e of diffServiceEvents(prevKindsRef.current as never, next)) {
      if (e.type === 'listening') {
        notify.success(`「${e.profileName}」就绪：${e.ports.map((p) => ':' + p).join(', ')}`);
      } else {
        notify.error(`「${e.profileName}」端口被占用：${e.ports.map((p) => ':' + p).join(', ')}${e.heldBy.length ? `（PID ${e.heldBy.join(', ')}）` : ''}`);
      }
    }
    prevKindsRef.current = new Map([...next].map(([id, v]) => [id, v.status.kind]));
    // latestRunOf 依赖 runs，已在依赖数组；profiles/connections 变更都需重算
  }, [runs, connections, profiles]);
```

行内徽章 IIFE 重构：map 回调里 `const run = runOf(p.id);` 之后加 `const svc = run ? resolveServiceStatus(run, p, connections) : null;`，原 `{run && (() => {...})()}` 替换为 `{svc && svc.kind !== 'no-ports' && (() => {...using svc...})()}`（保持 STATUS_BADGE 渲染逻辑不变，把 IIFE 内的 `const svc = ...` 行删掉）。

Globe 按钮（「日志」按钮前）：

```tsx
                      {svc && browseUrlForService(svc) && (
                        <IconButton
                          label="在浏览器打开服务"
                          size="xs"
                          onClick={() => void openExternalUrlOrNotify(browseUrlForService(svc)!)}
                        >
                          <Globe />
                        </IconButton>
                      )}
```

- [ ] **Step 2: 全量回归 + CHANGELOG**

CHANGELOG `[Unreleased]` 追加：

```markdown
- **服务守望与就绪跳转**：RunProfile 服务状态跃迁主动通知（就绪 success / 端口冲突 error 含占用 PID，状态不变不重复）；服务就绪后行内出现「在浏览器打开」按钮一键访问。
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/RunProfilesPanel.tsx CHANGELOG.md
git commit -m "feat(app): service watch toasts + ready browse button in run profiles"
```

---

## Self-Review 记录

- Spec §3.1 → Task 1；§3.2 → Task 2；§4 测试 → Task 1。无占位。
- 类型一致性：`ServiceWatchEvent.heldBy` 定为 `number[]`（listening 时空数组），测试断言与实现一致；`browseUrlForService` 返回类型与 Task 2 的 `!` 断言用法一致。
