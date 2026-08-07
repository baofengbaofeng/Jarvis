import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('renders with jui-textarea class', () => {
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId('ta').className).toMatch(/jui-textarea/);
  });
});
