import { forwardRef, type TextareaHTMLAttributes } from 'react';
import './Textarea.css';

export type TextareaProps = {
  className?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...rest }, ref) {
    const classes = ['jui-textarea', className].filter(Boolean).join(' ');
    return <textarea ref={ref} className={classes} {...rest} />;
  }
);
