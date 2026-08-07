import type { SelectHTMLAttributes } from 'react';
import './Select.css';

export type SelectProps = {
  className?: string;
} & SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...rest }: SelectProps) {
  const classes = ['jui-select', className].filter(Boolean).join(' ');
  return <select className={classes} {...rest}>{children}</select>;
}
