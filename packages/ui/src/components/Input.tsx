import type { InputHTMLAttributes } from 'react';
import './Input.css';

export type InputProps = {
  className?: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  const classes = ['jui-input', className].filter(Boolean).join(' ');
  return <input className={classes} {...rest} />;
}
