import type { HTMLAttributes } from 'react';
import './ToolChip.css';

export type ToolChipProps = HTMLAttributes<HTMLSpanElement> & {
  name: string;
  detail?: string;
};

export function ToolChip({ name, detail, className, ...rest }: ToolChipProps) {
  const classes = ['jui-tool-chip', className].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      <span className="jui-tool-chip__name">{name}</span>
      {detail != null && <span className="jui-tool-chip__detail">{detail}</span>}
    </span>
  );
}
