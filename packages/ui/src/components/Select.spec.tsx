import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
  it('renders with jui-select class', () => {
    render(<Select data-testid="sel"><option>A</option></Select>);
    expect(screen.getByTestId('sel').className).toMatch(/jui-select/);
  });
});
