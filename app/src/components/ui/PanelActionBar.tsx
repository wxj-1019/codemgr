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
        'flex min-h-9 items-center justify-between gap-1.5 border-t border-line bg-surface-panel/80 px-2 py-1.5',
        'panel-action-bar flex-wrap',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {leading}
        {eyebrow && <span className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">{eyebrow}</span>}
        {heading && <span className="text-xs font-semibold text-content">{heading}</span>}
        {summary && <span className="text-[11px] text-content-muted">{summary}</span>}
      </div>
      <div className="flex items-center gap-1">
        {children}
        {actions}
        {secondaryActions}
      </div>
    </div>
  );
}
