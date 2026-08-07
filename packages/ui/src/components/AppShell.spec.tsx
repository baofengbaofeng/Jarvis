import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';
import { Sidebar } from './Sidebar';
import { NavGroup } from './NavGroup';
import { NavItem } from './NavItem';
import { TopBar } from './TopBar';

describe('AppShell', () => {
  it('lays out sidebar, topbar, and main', () => {
    render(
      <AppShell
        sidebar={
          <Sidebar brand="JARVIS">
            <NavGroup label="Work">
              <NavItem href="/" active>Chat</NavItem>
            </NavGroup>
          </Sidebar>
        }
        topBar={<TopBar left="Agent" right="Tasks" />}
      >
        <div data-testid="main-slot">Main</div>
      </AppShell>
    );
    expect(screen.getByTestId('jui-appshell')).toBeTruthy();
    expect(screen.getByTestId('jui-sidebar')).toBeTruthy();
    expect(screen.getByTestId('jui-topbar')).toBeTruthy();
    expect(screen.getByTestId('main-slot')).toBeTruthy();
    expect(screen.getByText('Chat').className).toMatch(/jui-navitem--active/);
  });

  it('renders mainFooter when provided', () => {
    render(
      <AppShell
        sidebar={<Sidebar brand="JARVIS">nav</Sidebar>}
        mainFooter={<a href="https://example.com">repo</a>}
      >
        <div>Main</div>
      </AppShell>
    );
    expect(screen.getByTestId('jui-appshell-footer')).toBeTruthy();
    expect(screen.getByText('repo')).toBeTruthy();
  });
});
