import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders with variant class', () => {
    render(<Badge variant="plan">Plan</Badge>);
    expect(screen.getByText('Plan').className).toMatch(/jui-badge--plan/);
  });
});
