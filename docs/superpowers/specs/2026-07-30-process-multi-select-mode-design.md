# Process Multi-Select Mode Design

## Goal

Separate process inspection from batch selection. A normal row click focuses a process and opens its details. Processes enter the batch selection set only after the user explicitly enables multi-select mode.

## Interaction Contract

- `ProcessPanel` owns transient `multiSelectEnabled` local state; it is not persisted.
- Default mode:
  - row click calls `focus(pid, 'process')` only;
  - Enter/Space focuses the keyboard row only;
  - row and header checkboxes are hidden;
  - batch kill controls are hidden.
- Multi-select mode:
  - row click toggles selection and focuses the row;
  - checkbox toggles selection without changing detail focus;
  - Enter/Space toggles selection and focuses the row;
  - header checkbox selects or clears visible rows;
  - batch kill controls appear only when at least one process is selected.
- Clicking `多选` starts a fresh selection session by clearing stale selections.
- Clicking `完成` exits mode, clears selection, and closes a pending batch confirmation.
- A successful batch kill clears selection but keeps multi-select mode enabled; cancellation keeps selection.
- Tree and project-group views follow the same process-row contract. Group headers remain expand/collapse controls and group kill remains an independent action.

## Architecture

- `ProcessPanel`: mode state, toolbar toggle, clear-on-transition, batch-dialog cleanup; passes mode to both views.
- `ProcessTable`: splits focus and selection callbacks, conditionally renders checkbox column, and branches keyboard actions by mode.
- `ProjectGroupView`: makes child process rows focusable/clickable and conditionally renders selection checkboxes.
- `processPanelStore`: unchanged; existing `toggleSelect`, `selectAll`, `clearSelection`, and dead-PID pruning remain the selection data layer.
- `focusStore`: unchanged; remains the single-process detail focus layer.

## Accessibility

- Toggle button exposes `aria-pressed` and changes its visible label from `多选` to `完成`.
- Hidden checkbox controls are absent from the DOM and Tab order in default mode.
- Process rows retain roving `tabIndex`; keyboard semantics match pointer semantics.
- Selection state remains exposed through `aria-selected` only while multi-select mode is enabled.

## Testing

- Tree view: default click/keyboard focus only; multi-select click/keyboard selects; checkboxes appear only in mode; checkbox does not focus; dynamic colSpan remains valid.
- Project view: same default and multi-select contracts for child rows; group header behavior unchanged.
- ProcessPanel: mode toggle starts/ends clean sessions, exits close batch confirmation, batch controls require mode + selection.
- Existing sorting, virtualization, navigation, context menu, and kill tests remain green.
