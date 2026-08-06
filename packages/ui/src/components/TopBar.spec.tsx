import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from './TopBar';

describe('TopBar', () => {
  it('renders left and right slots', () => {
    render(<TopBar left="Agent" right="Tasks" />);
    expect(screen.getByTestId('jui-topbar')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });
});
