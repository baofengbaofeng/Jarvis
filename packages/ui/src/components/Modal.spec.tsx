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

  it('renders nothing when closed', () => {
    render(<Modal open={false} testId="modal">Body</Modal>);
    expect(screen.queryByTestId('modal')).toBeNull();
  });
});
