import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import './Modal.css';

export type ModalProps = {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  /** Label for the footer close control when `onClose` is set. Defaults to "Close". */
  closeLabel?: ReactNode;
  testId?: string;
};

export function Modal({ open, title, children, actions, onClose, closeLabel, testId }: ModalProps) {
  if (!open) return null;
  // Portal to body so nested usage (e.g. confirm inside another modal) is not
  // clipped by ancestor overflow / stacking contexts.
  return createPortal(
    <div className="jui-modal-backdrop" data-testid={testId} role="dialog" aria-modal="true">
      <div className="jui-modal-card">
        {title != null && <h3 className="jui-modal-card__title">{title}</h3>}
        <div className="jui-modal-card__body">{children}</div>
        {(actions || onClose) && (
          <div className="jui-modal-card__actions">
            {actions}
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                data-testid={testId ? `${testId}-close` : undefined}
              >
                {closeLabel ?? 'Close'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
