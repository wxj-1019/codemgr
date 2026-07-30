# CodeMgr Apple × Codex Desktop Workbench Design

> Status: **Phase 1 complete** — shell, design system, layout engine shipped (commit `5be5a25`).
> Remaining phases: panel unification, responsive tiles, portal overlays, desktop verification.

## Design Principles

- **Codex skeleton × Apple chrome × Linear density**: Codex-style workspace navigation + Apple-grade materials/hierarchy + Linear's high-information-density discipline.
- **Glass only on chrome, sidebar, overlays**; data surfaces stay stable, opaque, high-contrast.
- **Neutral gray ramp, cyan accent, green/amber/red status**; no emoji, no scattered purple/pink/blue hardcodes, no solid red danger buttons.
- **6px controls, 8px panels**, 28/32px control height, 1px hairline, short fade transitions.
- **Mosaic title bar is the sole panel title**; business panels never repeat `h1`.

## Phase 1 (COMPLETE — `feat/desktop-workbench`)

### Design System
- New semantic tokens: `surface/canvas/panel/elevated`, `content/primary/secondary/muted`, `line/focus/success/info/danger/warn/on-accent`
- Tailwind `<alpha-value>` support for opacity modifiers
- Light theme: independent deep semantic colors; `content-muted` ≥ 4.5:1; `ring-focus/70` on light canvas ≥ 3.2:1; `on-accent` ≥ 5.38:1
- Theme contract: root `.dark` / `.light` on app mount (before React createRoot)
- `lucide-react` icons via central facade (`icons.tsx`)
- UI primitives: `Button` (4 variants, 3 sizes, grid-overlay busy), `IconButton`, `Badge` (6 tones), `StateView`, `PanelActionBar`, `PanelAlert`
- Centralized `kindStyles.ts` (process kinds → Badge tones)
- Files: `app/src/index.css`, `app/tailwind.config.ts`, `app/index.html`, `app/src/components/ui/*`, `app/src/components/icons.tsx`, `app/src/lib/kindStyles.ts`

### Workspace Shell
- Codex-style sidebar (192px, 56px icon rail at <860px): monitoring group (process/port/perf), workflow group (AI sessions/snapshots/run profiles), extensions group (dynamic plugins)
- Workspace topbar (40px, `app-region: drag`, 152px Windows overlay reservation)
- App shell: `sidebar + (topbar + mosaic workspace)`
- Files: `app/src/components/workspace/WorkspaceSidebar.tsx`, `app/src/components/workspace/WorkspaceTopbar.tsx`, `app/src/App.tsx`

### Layout Engine
- `openPanel(id)`: idempotent (exists → activate; absent → 70/30 row split right; empty → leaf root)
- `preset: PresetId | null` — cleared on manual rearrange, restored on apply
- Persist v1: v0 migration with preset sync verification + duplicate PanelId dedup (DFS preserve-first)
- Active panel reconciliation: fallback to first leaf on close
- Mosaic: no `createNode` when no candidates (no rejected promises); pointer/focus capture on MosaicWindow wrapper for activation
- Files: `app/src/store/layoutStore.ts`, `app/src/store/activePanelStore.ts`, `app/src/components/Panel.tsx`

### Electron Chrome
- `titleBarStyle: 'hidden'` + neutral `titleBarOverlay` (dark bg, light symbols)
- `minWidth/minHeight` enforced; close/minimize → hide to tray preserved
- Background `#08090c` matches canvas token
- Files: `app/electron/main.ts`

### Panel Catalog
- Centralized 6 built-in panel definitions (id, title, group, icon, renderer)
- Plugin descriptor mapping from `PluginManifestEntry`
- `Record<BuiltInPanelId, BuiltInPanelCatalogEntry>` as single source of truth
- Files: `app/src/components/workspace/panelCatalog.tsx`

### Plugin Panel Fix
- Split `PluginPanel` into lookup shell + `LoadedPluginPanel` (eliminates hook count change on registry `false → loaded`)
- Sandbox preserved: `allow-scripts` only, no `allow-same-origin`
- Files: `app/src/components/PluginPanel.tsx`

### Tests (381 total, 73 new)
- `app/tests/layoutStore.test.ts` — 18 tests (openPanel, preset, v0 migration, dedup)
- `app/tests/panelCatalog.test.tsx` — 3 tests
- `app/tests/workspaceNavigation.test.tsx` — 14 tests
- `app/tests/uiPrimitives.test.tsx` — 27 tests
- `app/tests/designTokens.test.ts` — 11 tests
- `app/tests/themeStore.test.ts` — 3 tests
- `app/tests/activePanelStore.test.ts` — 8 tests
- `app/tests/PluginPanel.test.tsx` — 1 test

---

## Phase 2: Panel Chrome Unification (next)

**Scope**: Unify all 6 built-in panels to use shared action bars, status badges, empty states — removing duplicate `h1` headers and emoji.

### PortRadar
- Remove internal `h1` heading
- Migrate stats/search/poll interval/view-toggle into `PanelActionBar`
- Migrate filter conflict highlight badge to `Badge`
- Fix `flex-1/min-h-0/overflow-auto` scroll chain

### ProcessPanel
- Remove internal `h1` heading
- Migrate stats/search/poll interval/view-toggle into `PanelActionBar`
- Replace emoji kill/operations buttons with `IconButton` (quiet-danger for kill)
- Unify process kind badges via `getProcessKindTone()`
- Fix 9-column empty/virtual spacer `colSpan`

### PerfPanel
- Convert ~10 repeated surface/card class blocks to shared `SectionSurface` style
- Consolidate repeated Tooltip configs
- Remove internal `h1` heading
- Migrate interval selector to `PanelActionBar`

### SnapshotPanel
- Remove internal `h1` heading
- Migrate snapshot operations to `PanelActionBar`
- Replace emoji action buttons with `IconButton`
- Consolidate private `EmptyState` to shared `StateView`

### SessionPanel
- Remove internal `h1` heading
- Unify session status badges to semantic `Badge` tones (running→success, starting→info, conflict→warning, exited→neutral/danger)
- Replace solid red stop button with quiet-danger `Button`/`IconButton`
- Fix cyan focus → accent token; fuchsia badge → semantic tone
- Consolidate duplicate empty/non-empty headers

### RunProfilesPanel
- Remove internal `h1` heading
- Unify run profile status badges to semantic `Badge` tones
- Replace solid red stop/delete with quiet-danger
- Replace hardcoded green/amber/red with tokenized success/warning/danger

### PluginPanel
- Replace hardcoded `bg-base-panel` (nonexistent) with `bg-surface-panel`

### Shared
- Narrow-safe `PanelActionBar`: flex-wrap, search min-width:0, collapse secondary actions
- Panel header responsiveness by container query (not window `matchMedia`)
- All tool buttons use `lucide-react` via icons facade (no emoji, no unicode glyphs)

---

## Phase 3: Responsive Behavior by Tile Width

### Container Queries
- `Panel` establishes CSS `container-type: inline-size`
- Visual wrapping uses container queries
- Sidebar visibility decisions use `ResizeObserver` hook (`useContainerWidth`)

### Process Detail Sidebar
- Show only when *current tile* is wide enough (not `window.matchMedia(1024px)`)
- In narrow tiles: hide sidebar, or show as collapsed toggle

### Snapshot Left Panel
- Narrow tile: collapse selector row to compact top bar
- Wide tile: preserve 256px side-by-side layout

### Table Fixes
- PortTable: `flex-1/min-h-0/overflow-auto` scroll chain
- ProcessTable: 9-column empty/virtual spacer colSpan fix
- Initial `tabIndex=0` entry point (preserve existing roving focus)

### Tests
- `app/tests/useContainerWidth.test.tsx`
- Extend PortTable/ProcessTable keyboard and virtualization tests

---

## Phase 4: Portal Overlays (Dialog + Menu)

### Dialog
- Portal to `document.body` (not inside `.glass` containing block)
- `role="dialog"`, `aria-labelledby`, initial focus, focus trap, Escape, focus restore
- Busy state prevents double-close/submit
- Replace inline backdrop/surface/header/footer patterns in:
  - `ConfirmDialog`
  - `LabelRuleEditor`
  - `DiagnosticPreview`
  - `RunProfileEditor`

### Menu
- Portal to `document.body`; reuses `ContextMenu` keyboard model
- Arrow/Home/End/Enter/Escape, outside-click dismiss, viewport flip
- Replace:
  - `ContextMenu` (keep context coordinate entry, swap rendering)
  - App plugin dropdown (no menu semantics currently)
  - Workspace sidebar overflow menus

### Danger Interactions
- All danger operations use quiet-danger `Button`/`IconButton`
- Preserve existing `ConfirmDialog` double-confirmation semantics
- No solid red buttons

### Tests
- Extend `ConfirmDialog.test.tsx`, `ContextMenu.test.tsx`, `LabelRuleEditor.test.tsx`
- New: portal behavior, focus restore, dropdown dismissal assertions

---

## Phase 5: Verification & Documentation

### Automated
1. `pnpm -C app vitest run` — all passing, no regression (<381 tests expected to grow)
2. `pnpm -C app typecheck` — clean
3. `pnpm build:app` — clean (renderer + Electron main + preload)
4. `pnpm --dir codemgr-native build:electron` — native ABI for Electron
5. `pnpm dev` — electron app starts without crash

### Desktop Acceptance
1. Window sizes: 1100×720, narrow (~860px), maximized
2. Themes: dark + light (no visual regressions)
3. Windows native: min/max/close, titlebar drag, close→tray, tray→restore
4. All 6 built-in panels: open, repeat click (idempotent), split, drag, close, expand, zero-state restore, layout presets
5. Tables: keyboard entry, virtual scroll, context menu
6. Dialogs: focus trap, Escape, focus restore
7. Checks: no text overflow, no clipped overlays, no duplicate titles, clear contrast in both themes, no fixed-width squeeze in narrow tiles

### Documentation
- Update `CHANGELOG.md` v2.3 unreleased section
- Update `AGENTS.md` test count

---

## Out of Scope (explicitly)

- Native collector, IPC contracts, polling intervals, business store data models, kill protection
- Replacing `react-mosaic`, adding chat composer, large animations, marketing pages, full-transparent backgrounds
- Plugin relative-path contract, packaging tray icon resources
- `@vitest/ui` / Vitest version alignment (baseline pre-existing)
