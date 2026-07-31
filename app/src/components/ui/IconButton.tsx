import type { ButtonHTMLAttributes } from 'react';
import { cx, type ButtonSize, type ButtonVariant } from './Button';

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-6 w-6 rounded-full [&>svg]:h-3 [&>svg]:w-3',
  sm: 'h-7 w-7 rounded-full [&>svg]:h-3.5 [&>svg]:w-3.5',
  md: 'h-8 w-8 rounded-full [&>svg]:h-4 [&>svg]:w-4',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-b from-accent-hover to-accent text-on-accent shadow-sm shadow-accent/25 ring-1 ring-inset ring-accent-muted/30 hover:shadow-md hover:shadow-accent/35 hover:-translate-y-px active:bounce-pop transition-all duration-200',
  secondary: 'border border-line bg-surface-raised text-content-secondary hover:bg-surface-overlay hover:text-content-primary hover:-translate-y-px active:bounce-pop transition-all duration-200',
  ghost: 'bg-transparent text-content-secondary hover:bg-surface-raised hover:text-content-primary hover:-translate-y-px active:bounce-pop transition-all duration-200',
  dangerQuiet: 'border border-danger/40 bg-transparent text-danger hover:bg-danger hover:text-on-accent hover:-translate-y-px active:bounce-pop transition-all duration-200',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function IconButton({
  label,
  title = label,
  size = 'sm',
  variant = 'ghost',
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={title}
      data-variant={variant}
      data-size={size}
      className={cx(
        'inline-flex shrink-0 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/70 disabled:pointer-events-none disabled:opacity-50',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
