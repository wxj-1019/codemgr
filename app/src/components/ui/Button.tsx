import type { ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dangerQuiet';
export type ButtonSize = 'xs' | 'sm' | 'md';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-sm hover:bg-accent-hover',
  secondary: 'border border-line bg-surface-raised text-content-primary hover:bg-surface-overlay',
  ghost: 'bg-transparent text-content-secondary hover:bg-surface-raised hover:text-content-primary',
  dangerQuiet: 'border border-danger/40 bg-transparent text-danger hover:bg-danger hover:text-on-accent',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'min-h-6 gap-1 px-2 py-0.5 text-[11px]',
  sm: 'min-h-7 gap-1.5 px-2.5 py-1 text-xs',
  md: 'min-h-8 gap-2 px-3 py-1.5 text-sm',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-busy'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  busyLabel = 'Loading',
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-variant={variant}
      data-size={size}
      className={cx(
        'grid w-fit shrink-0 items-center justify-center rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      <span
        className={cx('col-start-1 row-start-1 inline-flex items-center justify-center gap-inherit', busy && 'invisible')}
        aria-hidden={busy || undefined}
      >
        {children}
      </span>
      {busy && (
        <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>{busyLabel}</span>
        </span>
      )}
    </button>
  );
}
