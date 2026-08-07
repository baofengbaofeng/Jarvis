import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('renders with jui-input class', () => {
    render(<Input data-testid="inp" placeholder="Email" />);
    expect(screen.getByTestId('inp').className).toMatch(/jui-input/);
  });
});
