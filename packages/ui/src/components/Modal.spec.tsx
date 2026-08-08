import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Modal } from './Modal';

afterEach(cleanup);

describe('Modal', () => {
  it('renders when open', () => {
    render(<Modal open title="Test" testId="modal">Body</Modal>);
    expect(screen.getByTestId('modal')).toBeTruthy();
    expect(screen.getByText('Test')).toBeTruthy();
  });

  it('portals to document.body so nested overflow ancestors cannot clip it', () => {
    render(
      <div style={{ overflow: 'auto', height: 40 }}>
        <Modal open testId="modal">Body</Modal>
      </div>,
    );
    const el = screen.getByTestId('modal');
    expect(el.parentElement).toBe(document.body);
  });

  it('renders nothing when closed', () => {
    render(<Modal open={false} testId="modal">Body</Modal>);
    expect(screen.queryByTestId('modal')).toBeNull();
  });

  it('renders a small text close button when onClose is set', () => {
    render(
      <Modal open testId="modal" closeLabel="关闭" onClose={() => {}}>
        Body
      </Modal>,
    );
    const close = screen.getByTestId('modal-close');
    expect(close.textContent).toBe('关闭');
    expect(close.className).toContain('jui-btn--sm');
  });
});
