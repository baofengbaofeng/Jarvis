import type { HTMLAttributes } from 'react';
import './FileChip.css';

export type FileChipProps = HTMLAttributes<HTMLSpanElement> & {
  name: string;
  onRemove?: () => void;
};

export function FileChip({ name, onRemove, className, ...rest }: FileChipProps) {
  const classes = ['jui-file-chip', className].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      <span className="jui-file-chip__name">{name}</span>
      {onRemove != null && (
        <button type="button" className="jui-file-chip__remove" aria-label={`Remove ${name}`} onClick={onRemove}>×</button>
      )}
    </span>
  );
}
