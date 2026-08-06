import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavItem } from './NavItem';

describe('NavItem', () => {
  it('applies active class when active', () => {
    render(<NavItem href="/" active>Chat</NavItem>);
    expect(screen.getByText('Chat').className).toMatch(/jui-navitem--active/);
  });

  it('renders as anchor with href', () => {
    render(<NavItem href="/settings">Settings</NavItem>);
    const link = screen.getByRole('link', { name: 'Settings' });
    expect(link.getAttribute('href')).toBe('/settings');
    expect(link.className).toMatch(/jui-navitem/);
  });
});
