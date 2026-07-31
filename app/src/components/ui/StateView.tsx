import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle } from '../icons';
import { cx } from './Button';

export type StateViewState = 'loading' | 'empty' | 'error';

const ICONS = {
  loading: LoaderCircle,
  empty: Inbox,
  error: AlertCircle,
};

export interface StateViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role' | 'aria-live'> {
  state: StateViewState;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function StateView({
  state,
  title,
  description,
  action,
  icon,
  className,
  ...props
}: StateViewProps) {
  const Icon = ICONS[state];
  const role = state === 'error' ? 'alert' : 'status';

  return (
    <div
      {...props}
      role={role}
      aria-live={state === 'error' ? 'assertive' : 'polite'}
      data-state={state}
      className={cx('flex min-h-32 flex-col items-center justify-center px-6 py-8 text-center', className)}
    >
      <div className={cx('mb-3 text-content-muted', state === 'error' && 'text-danger')} aria-hidden="true">
        {icon ?? <Icon className={cx('h-5 w-5', state === 'loading' && 'animate-spin')} />}
      </div>
      <h3 className="text-sm font-medium text-content-primary">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-content-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}