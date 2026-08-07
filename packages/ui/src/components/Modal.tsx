import type { ReactNode } from 'react';
import { Button } from './Button';
import './Modal.css';

export type ModalProps = {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  testId?: string;
};

export function Modal({ open, title, children, actions, onClose, testId }: ModalProps) {
  if (!open) return null;
  return (
    <div className="jui-modal-backdrop" data-testid={testId} role="dialog" aria-modal="true">
      <div className="jui-modal-card">
        {title != null && <h3 className="jui-modal-card__title">{title}</h3>}
        <div className="jui-modal-card__body">{children}</div>
        {(actions || onClose) && (
          <div className="jui-modal-card__actions">
            {actions}
            {onClose && (
              <Button variant="ghost" onClick={onClose}>×</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
