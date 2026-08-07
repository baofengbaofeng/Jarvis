import type { ReactNode } from 'react';
import './EmptyState.css';

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  const classes = ['jui-empty', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <h3 className="jui-empty__title">{title}</h3>
      {description != null && <p className="jui-empty__desc">{description}</p>}
      {action != null && <div className="jui-empty__action">{action}</div>}
    </div>
  );
}
