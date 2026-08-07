import type { ReactNode } from 'react';
import './MessageBubble.css';

export type MessageBubbleProps = {
  role: 'user' | 'assistant' | 'system';
  children: ReactNode;
  className?: string;
};

export function MessageBubble({ role, children, className }: MessageBubbleProps) {
  const classes = [
    'jui-message',
    `jui-message--${role}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} data-role={role}>
      <div className="jui-message__content">{children}</div>
    </div>
  );
}
