import type { ReactNode } from 'react';
import './StepCard.css';

export type StepCardStatus = 'pending' | 'running' | 'success' | 'error' | 'warning';

export type StepCardProps = {
  title: string;
  status?: StepCardStatus;
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function StepCard({
  title,
  status = 'pending',
  children,
  defaultOpen = false,
  className,
}: StepCardProps) {
  const classes = ['jui-stepcard', className].filter(Boolean).join(' ');
  return (
    <details className={classes} open={defaultOpen}>
      <summary className="jui-stepcard__header">
        <span className={`jui-stepcard__dot jui-stepcard__dot--${status}`} aria-hidden />
        <span className="jui-stepcard__title">{title}</span>
      </summary>
      {children != null && <div className="jui-stepcard__body">{children}</div>}
    </details>
  );
}
