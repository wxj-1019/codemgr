import type { HTMLAttributes } from 'react';
import { cx } from './Button';

export type BadgeTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'accent';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-content-muted/15 text-content-secondary ring-line',
  success: 'bg-success/15 text-success ring-success/25',
  info: 'bg-info/15 text-info ring-info/25',
  warning: 'bg-warn/15 text-warn ring-warn/25',
  danger: 'bg-danger/15 text-danger ring-danger/25',
  accent: 'bg-accent/15 text-accent ring-accent/25',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      data-tone={tone}
      className={cx(
        'inline-flex min-h-5 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ring-1 ring-inset transition-colors duration-200',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}