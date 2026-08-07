import type { HTMLAttributes } from 'react';
import { Badge } from './Badge';
import type { BadgeVariant } from './Badge';

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'default' | 'info' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
};

const STATUS_VARIANT: Record<StatusBadgeProps['status'], BadgeVariant> = {
  queued: 'default',
  running: 'warning',
  completed: 'success',
  failed: 'danger',
  paused: 'default',
  cancelled: 'default',
  default: 'default',
  info: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function StatusBadge({ status, children, className, ...rest }: StatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={['jui-status-badge', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Badge>
  );
}
