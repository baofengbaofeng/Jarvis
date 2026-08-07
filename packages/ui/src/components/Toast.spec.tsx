import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toast } from './Toast';

describe('Toast', () => {
  it('renders with kind modifier', () => {
    render(<Toast message="Done" kind="success" testId="t" />);
    expect(screen.getByTestId('t').className).toMatch(/jui-toast--success/);
  });
});
