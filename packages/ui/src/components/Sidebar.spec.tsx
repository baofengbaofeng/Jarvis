import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders brand, children, and footer', () => {
    render(
      <Sidebar brand="JARVIS" footer="v1.0">
        <div>Nav</div>
      </Sidebar>
    );
    expect(screen.getByTestId('jui-sidebar')).toBeTruthy();
    expect(screen.getByText('JARVIS')).toBeTruthy();
    expect(screen.getByText('Nav')).toBeTruthy();
    expect(screen.getByText('v1.0')).toBeTruthy();
  });
});
