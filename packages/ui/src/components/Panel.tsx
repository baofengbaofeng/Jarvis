import type { HTMLAttributes, ReactNode } from 'react';
import './Panel.css';

export type PanelProps = {
  elevated?: boolean;
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section';
} & HTMLAttributes<HTMLElement>;

export function Panel({
  elevated = false,
  className,
  children,
  as: Component = 'div',
  ...rest
}: PanelProps) {
  const classes = [
    'jui-panel',
    elevated && 'jui-panel--elevated',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
