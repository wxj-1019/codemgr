import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './Button';

export interface PanelActionBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'title'> {
  label: string;
  eyebrow?: ReactNode;
  heading?: ReactNode;
  summary?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
}

export function PanelActionBar({
  label,
  eyebrow,
  heading,
  summary,
  leading,
  actions,
  secondaryActions,
  className,
  children,
  ...props
}: PanelActionBarProps) {
  return (
    <div
      {...props}
      data-testid="panel-action-bar"
      role="toolbar"
      aria-label={label}
      className={cx(
        'panel-action-bar flex min-h-9 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-line bg-surface-panel/80 px-2 py-1.5',
        className,
      )}
    >
      <div data-panel-context className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {leading}
        {eyebrow && <span className="shrink-0 text-[10px] font-semibold uppercase text-content-muted">{eyebrow}</span>}
        {heading && <span className="shrink-0 text-xs font-semibold text-content-primary">{heading}</span>}
        {summary && <span className="min-w-0 truncate text-[11px] text-content-muted" title={typeof summary === 'string' ? summary : undefined}>{summary}</span>}
      </div>
      <div data-panel-actions className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
        {children}
        {actions}
        {secondaryActions}
      </div>
    </div>
  );
}
