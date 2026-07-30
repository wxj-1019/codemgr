import type { HTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from '../icons';
import { cx } from './Button';

export type PanelAlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<PanelAlertTone, string> = {
  info: 'border-info/25 bg-info/10 text-info',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warn/25 bg-warn/10 text-warn',
  danger: 'border-danger/25 bg-danger/10 text-danger',
};

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: AlertCircle,
};

export interface PanelAlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'aria-live'> {
  tone?: PanelAlertTone;
}

export function PanelAlert({ tone = 'info', className, children, ...props }: PanelAlertProps) {
  const Icon = ICONS[tone];

  return (
    <div
      {...props}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      data-tone={tone}
      className={cx(
        'flex items-start gap-2 border-y px-3 py-2 text-xs leading-5',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-content-secondary">{children}</div>
    </div>
  );
}
