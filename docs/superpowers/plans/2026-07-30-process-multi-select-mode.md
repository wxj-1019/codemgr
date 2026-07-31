# Process Multi-Select Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal process-row clicks inspect a process, while batch selection is available only through an explicit multi-select mode.

**Architecture:** `ProcessPanel` owns ephemeral mode state and passes it to both process views. Existing Zustand selection and focus stores remain separate: selection stores batch targets; focus stores the single process shown in details.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, Testing Library

---

### Task 1: Tree Table Selection Contract

**Files:**
- Modify: `app/tests/processTableSelect.test.tsx`
- Modify: `app/tests/processTableKeyboard.test.tsx`
- Modify: `app/tests/processTableVirtual.test.tsx`
- Modify: `app/src/components/ProcessTable.tsx`

- [x] Add failing tests for default row click/Enter/Space focusing without selecting; hidden checkbox column; enabled-mode row/keyboard selection; checkbox selection without focus; dynamic 8/9 column spans.
- [x] Run the three test files and confirm failures are caused by the missing `multiSelectEnabled` contract.
- [x] Add `multiSelectEnabled?: boolean`; separate `focusRow`, `toggleRowSelection`, and checkbox handlers; conditionally render checkbox header/cells; branch keyboard behavior by mode.
- [x] Run the three test files until green without changing sorting, virtualization, navigation, context-menu, or kill behavior.

### Task 2: Panel Mode Lifecycle

**Files:**
- Create: `app/tests/processPanelMultiSelect.test.tsx`
- Modify: `app/src/components/ProcessPanel.tsx`

- [x] Add failing tests for `多选`/`完成`, `aria-pressed`, clear-on-enter, clear-and-close-on-exit, and batch controls requiring mode plus selection.
- [x] Add local `multiSelectEnabled`; implement mode transition handler; pass mode to active view; keep mode enabled after successful batch kill while clearing selection.
- [x] Run the panel and tree tests until green.

### Task 3: Project Group Selection Contract

**Files:**
- Create: `app/tests/projectGroupMultiSelect.test.tsx`
- Modify: `app/src/components/ProjectGroupView.tsx`
- Modify: `app/src/components/ProcessPanel.tsx`

- [x] Add failing tests for default child-row focus, mode-only checkboxes and selection, checkbox focus isolation, and unchanged group-header expand behavior.
- [x] Add `multiSelectEnabled` prop; connect existing selection/focus store methods; conditionally render child-row checkboxes and `aria-selected`; preserve group kill behavior.
- [x] Pass mode from `ProcessPanel` and run project/panel tests until green.

### Task 4: Verification and Documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`

- [x] Run `pnpm -C app exec vitest run`; require all tests passing.
- [x] Run `pnpm -C app typecheck` and `pnpm build:app`.
- [x] Rebuild native Electron ABI only if native files changed; otherwise retain existing addon (no native files changed).
- [x] Start `pnpm dev`; verify renderer page in default and multi-select modes, keyboard behavior, detail sidebar, batch confirmation, narrow/wide tile rendering, and Mosaic controls. Electron host launched successfully with the existing native API; the current IAB exposes the Vite renderer tab but cannot attach to the native Electron BrowserWindow, so native-window clicks were not automatable in this environment.
- [x] Update changelog and test counts; run `git diff --check`.
