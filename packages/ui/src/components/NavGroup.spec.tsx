import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavGroup } from './NavGroup';
import { NavItem } from './NavItem';

describe('NavGroup', () => {
  it('renders label and children', () => {
    render(
      <NavGroup label="Work">
        <NavItem href="/">Chat</NavItem>
      </NavGroup>
    );
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByText('Chat')).toBeTruthy();
  });
});
