import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    render(<PageHeader title="Settings" subtitle="Preferences" />);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Preferences')).toBeTruthy();
  });
});
