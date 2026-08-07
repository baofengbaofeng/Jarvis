import type { ReactNode } from 'react';
import { Button } from './Button';
import { Textarea } from './Textarea';
import './Composer.css';

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  sendLabel?: string;
  toolbar?: ReactNode;
  attachments?: ReactNode;
  inputTestId?: string;
  sendTestId?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  sendLabel = 'Send',
  toolbar,
  attachments,
  inputTestId,
  sendTestId,
  onKeyDown,
  onPaste,
}: ComposerProps) {
  return (
    <div className="jui-composer">
      {toolbar && <div className="jui-composer__toolbar">{toolbar}</div>}
      {attachments && <div className="jui-composer__attachments">{attachments}</div>}
      <div className="jui-composer__row">
        <Textarea
          className="jui-composer__input"
          data-testid={inputTestId}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={3}
        />
        <Button
          variant="primary"
          data-testid={sendTestId}
          disabled={disabled}
          onClick={onSubmit}
        >
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}
