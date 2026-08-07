import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders brand, children, and footer', () => {
    render(
      <Sidebar brand="JARVIS" footer="1.0.0-Preview">
        <div>Nav</div>
      </Sidebar>
    );
    expect(screen.getByTestId('jui-sidebar')).toBeTruthy();
    expect(screen.getByText('JARVIS')).toBeTruthy();
    expect(screen.getByText('Nav')).toBeTruthy();
    expect(screen.getByText('1.0.0-Preview')).toBeTruthy();
  });
});
