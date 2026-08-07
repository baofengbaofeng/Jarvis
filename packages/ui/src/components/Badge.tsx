import type { HTMLAttributes, ReactNode } from 'react';
import './Badge.css';

export type BadgeVariant = 'default' | 'plan' | 'success' | 'warning' | 'danger';

export type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
} & HTMLAttributes<HTMLSpanElement>;

export function Badge({ children, variant = 'default', className, ...rest }: BadgeProps) {
  const classes = ['jui-badge', `jui-badge--${variant}`, className].filter(Boolean).join(' ');
  return <span className={classes} {...rest}>{children}</span>;
}
