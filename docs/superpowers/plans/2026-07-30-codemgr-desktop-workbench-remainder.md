# CodeMgr Desktop Workbench — Remaining Phases Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Status:** Phase 1 COMPLETE (commit `5be5a25`, 381 tests). This document covers Phases 2–5.

**Goal:** Complete Apple × Codex desktop workbench by unifying panel chrome, enabling responsive tiles, adding portal overlays, and performing desktop verification.

**Tech Stack:** React 18 + TypeScript + Tailwind + Zustand + react-mosaic + lucide-react

---

## Phase 2: Panel Chrome Unification

### Task 2.1: PortRadar & ProcessPanel Action Bars

**Files:**
- Modify: `app/src/components/PortRadar.tsx`
- Modify: `app/src/components/ProcessPanel.tsx`
- Modify: `app/src/components/PortTable.tsx` (scroll chain)
- Modify: `app/src/components/ProcessTable.tsx` (9-column colSpan)
- Test: extend existing `PortTable.test.tsx`, `processTableVirtual.test.tsx`

- [ ] **Step 1: Write regression tests for panel action bar rendering**
   - Assert PortRadar renders `PanelActionBar` with `role="toolbar"` and filter/search/interval in it
   - Assert ProcessPanel renders `PanelActionBar` with stats/search/interval/view-toggle
   - Assert no `h1` visible inside either panel (Mosaic title is sole heading)
   - Assert kill button uses `IconButton` with `aria-label` (not emoji)
   - Run: `pnpm -C app exec vitest run tests/PortTable.test.tsx` — confirm RED for new assertions

- [ ] **Step 2: Implement PortRadar action bar**
   - Remove internal `<h1>`, migrate stats (e.g., "12 listeners") into `PanelActionBar.summary`
   - Move search input, poll interval, view toggle into `PanelActionBar.children`
   - Replace emoji filter icons with `Search`/`Filter` from icons facade
   - Keep existing `PortTable` data logic unchanged

- [ ] **Step 3: Implement ProcessPanel action bar**
   - Remove internal `<h1>`, migrate stats into `PanelActionBar.summary`
   - Move search, poll interval, view toggle, kill buttons into `PanelActionBar`
   - Kill/operations buttons: `IconButton variant="dangerQuiet"` with `Skull`/`Trash2` from icons
   - Process kind badges: use `getProcessKindTone()` + `Badge`
   - Keep existing `ProcessTable` data/virtualization/selection logic unchanged

- [ ] **Step 4: Fix scroll chain and colSpan**
   - PortTable: ensure `flex-1 min-h-0 overflow-auto` on scroll container, verify in narrow tile test
   - ProcessTable: fix empty state row `colSpan={9}` (currently 8), fix virtual spacer `colSpan`

- [ ] **Step 5: Run tests, verify**
   - Run: `pnpm -C app exec vitest run tests/PortTable.test.tsx tests/processTableVirtual.test.tsx tests/processTableKeyboard.test.tsx`
   - Expected: all existing tests PASS, new assertions PASS
   - Run: `pnpm -C app typecheck`

### Task 2.2: PerfPanel, SnapshotPanel, SessionPanel, RunProfilesPanel

**Files:**
- Modify: `app/src/components/PerfPanel.tsx`
- Modify: `app/src/components/SnapshotPanel.tsx`
- Modify: `app/src/components/SessionPanel.tsx`
- Modify: `app/src/components/RunProfilesPanel.tsx`
- Modify: `app/src/components/PluginPanel.tsx`
- Test: extend existing tests for these components if any; otherwise rely on typecheck + build + GUI

- [ ] **Step 1: Update PerfPanel**
   - Remove internal `h1`
   - Consolidate ~10 repeated `className="rounded-lg border border-line bg-surface-panel p-3"` into a shared `SectionSurface` style (use `cx()` or a simple component/className constant — no new file required)
   - Consolidate 3 repeated Tooltip configs into a shared `tooltipProps` constant
   - Migrate interval selector to `PanelActionBar`

- [ ] **Step 2: Update SnapshotPanel**
   - Remove internal `h1`
   - Migrate action buttons (capture, compare, delete) to `PanelActionBar`
   - Replace emoji buttons with `IconButton` (use `Camera`, `GitCompare`, `Trash2`)
   - Replace private `EmptyState` with shared `StateView`
   - Fix `uppercase` table header class

- [ ] **Step 3: Update SessionPanel**
   - Remove internal `h1` (both empty and non-empty headers)
   - Unify session status badges: `running→Badge tone="success"`, `starting→tone="info"`, `conflict→tone="warning"`, `exited→tone="neutral"`
   - Replace solid red stop with `Button variant="dangerQuiet"` or `IconButton variant="dangerQuiet"`
   - Fix cyan focus → `ring-accent`; fuchsia badge → semantic tone
   - Consolidate duplicate header structures

- [ ] **Step 4: Update RunProfilesPanel**
   - Remove internal `h1`
   - Unify status badges: `running→success`, `stopped→neutral`, `failed→danger`
   - Replace hardcoded green/amber/red → tokenized `text-success`/`text-warn`/`text-danger`
   - Replace solid red stop/delete with quiet-danger

- [ ] **Step 5: Update PluginPanel**
   - Replace nonexistent `bg-base-panel` with `bg-surface-panel`

- [ ] **Step 6: Run full tests, typecheck, build**
   - Run: `pnpm -C app exec vitest run && pnpm -C app typecheck && pnpm build:app`
   - Expected: all PASS, no new ts errors

---

## Phase 3: Responsive Tile Width

### Task 3.1: Container Queries + useContainerWidth Hook

**Files:**
- Create: `app/src/hooks/useContainerWidth.ts`
- Modify: `app/src/components/Panel.tsx`
- Modify: `app/src/index.css`
- Test: `app/tests/useContainerWidth.test.tsx`

- [ ] **Step 1: Add container query to Panel**
   - In `index.css`, add `container-type: inline-size; container-name: panel;` to Panel's CSS
   - Add `.panel-narrow` / `.panel-wide` container query breakpoints at 560px

- [ ] **Step 2: Create useContainerWidth hook**
   ```ts
   // Returns the current container width in px, or null if not measured
   export function useContainerWidth(ref: RefObject<HTMLElement | null>): number | null
   ```
   Uses `ResizeObserver` on the ref; cleans up on unmount.

- [ ] **Step 3: Run tests, typecheck**

### Task 3.2: ProcessDetailSidebar Responsive

**Files:**
- Modify: `app/src/components/ProcessPanel.tsx`
- Modify: `app/src/components/ProcessDetailSidebar.tsx`

- [ ] **Step 1: Replace window.matchMedia with container width**
   - Remove `useMediaQuery('(min-width:1024px)')` in ProcessDetailSidebar parent
   - Use `useContainerWidth(panelRef)` → show sidebar only when container ≥ 720px
   - Narrow: hide sidebar; medium: collapsed toggle

- [ ] **Step 2: Run existing process tests, typecheck**

### Task 3.3: SnapshotPanel Responsive

**Files:**
- Modify: `app/src/components/SnapshotPanel.tsx`

- [ ] **Step 1: Collapse snapshot sidebar in narrow tiles**
   - Narrow tile (<480px): selector becomes top compact bar
   - Wide tile: preserve existing 256px side-by-side

- [ ] **Step 2: Verify build passes**

---

## Phase 4: Portal Overlays

### Task 4.1: Dialog Component

**Files:**
- Create: `app/src/components/ui/Dialog.tsx`
- Modify: `app/src/components/ConfirmDialog.tsx`
- Modify: `app/src/components/LabelRuleEditor.tsx`
- Modify: `app/src/components/DiagnosticPreview.tsx`
- Modify: `app/src/components/RunProfileEditor.tsx`
- Test: extend `ConfirmDialog.test.tsx`, `LabelRuleEditor.test.tsx`

- [ ] **Step 1: Write Dialog tests RED**
   - Test portal to `document.body`
   - Test `role="dialog"`, `aria-labelledby` association
   - Test focus trap (Tab cycles inside, Shift+Tab reverses)
   - Test Escape closes, focus restores to trigger
   - Test busy state prevents close/submit
   - Run: confirm RED (Dialog not implemented)

- [ ] **Step 2: Implement Dialog**
   ```tsx
   interface DialogProps {
     open: boolean;
     onOpenChange: (open: boolean) => void;
     title: string;
     description?: string;
     children: ReactNode;
     initialFocusRef?: RefObject<HTMLElement>;
     busy?: boolean;
   }
   ```
   Use `createPortal` to `document.body`; include focus trap, overlay, Escape handler.

- [ ] **Step 3: Migrate ConfirmDialog to use Dialog**
   - `ConfirmDialog` renders `Dialog` as its base; keep its confirm/cancel button semantics
   - Update tests to verify new Dialog behavior still works through ConfirmDialog

- [ ] **Step 4: Migrate LabelRuleEditor, DiagnosticPreview, RunProfileEditor**
   - Each uses `Dialog` under the hood; keeps its own form/content

- [ ] **Step 5: Run tests, typecheck, build**

### Task 4.2: Menu Component

**Files:**
- Create: `app/src/components/ui/Menu.tsx`
- Modify: `app/src/components/ContextMenu.tsx`
- Modify: `app/src/App.tsx` (plugin dropdown)
- Test: extend `ContextMenu.test.tsx`

- [ ] **Step 1: Write Menu tests RED**
   - Test portal to `document.body`
   - Test Arrow/Home/End navigation
   - Test Enter selects, Escape closes
   - Test outside click dismisses
   - Test viewport flip (open up when near bottom edge)
   - Run: confirm RED

- [ ] **Step 2: Implement Menu**
   ```tsx
   interface MenuProps {
     trigger?: ReactNode; // if omitted, use as context menu
     items: Array<{ label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }>;
     open?: boolean;
     onOpenChange?: (open: boolean) => void;
     anchorPoint?: { x: number; y: number }; // for context menu
   }
   ```

- [ ] **Step 3: Rewire ContextMenu to use Menu**
   - `ContextMenu` becomes a thin wrapper that computes `anchorPoint` and delegates to `Menu`

- [ ] **Step 4: Rewire App plugin dropdown to use Menu**
   - Replace current un-styled plugin menu with `Menu` trigger mode

- [ ] **Step 5: Run tests, typecheck, build**

---

## Phase 5: Verification & Docs

### Task 5.1: Full Automated Verification

- [ ] **Step 1: Run full test suite**
   ```bash
   pnpm -C app exec vitest run
   ```
   Expected: all passing, no regression from 381 baseline

- [ ] **Step 2: Typecheck**
   ```bash
   pnpm -C app typecheck
   ```
   Expected: clean

- [ ] **Step 3: Build**
   ```bash
   pnpm build:app
   ```
   Expected: renderer + main + preload all pass

- [ ] **Step 4: Native ABI for Electron**
   ```bash
   pnpm --dir codemgr-native build:electron
   ```
   Expected: no errors (no native code changes in this PR)

### Task 5.2: Desktop GUI Verification

- [ ] **Step 1: Launch dev mode**
   ```bash
   pnpm dev
   ```

- [ ] **Step 2: Verify at 3 window sizes** (1100×720, narrow ~860px, maximized)
   - All 6 panels open, repeat-click, split, drag, close, expand
   - Zero-state recovery, layout presets
   - Tables: keyboard entry, virtual scroll, context menu
   - Dialogs: focus trap, Escape, focus restore
   - No text overflow, no clipped overlays, no duplicate titles

- [ ] **Step 3: Verify both themes**
   - Dark theme: all text readable, controls visible
   - Light theme: all text readable, focus rings visible (≥3:1)

- [ ] **Step 4: Verify Electron chrome**
   - Titlebar drag, min/max/close
   - Close → tray, tray → restore
   - DevTools console: no errors

### Task 5.3: Documentation

- [ ] **Step 1: Update CHANGELOG.md**
   - Add desktop workbench entries under v2.3 unreleased

- [ ] **Step 2: Update AGENTS.md**
   - Update test count in §8
   - Add new file navigation entries for `app/src/components/ui/`, `app/src/components/workspace/`

- [ ] **Step 3: Commit and push**
   ```bash
   git add -A
   git commit -m "feat(app): panel chrome unification, responsive tiles, portal overlays"
   git push
   ```
