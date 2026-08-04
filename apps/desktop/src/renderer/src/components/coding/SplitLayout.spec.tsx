import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SplitLayout } from './SplitLayout';

afterEach(() => { cleanup(); });

describe('SplitLayout', () => {
  it('renders left and right panes with a divider', () => {
    render(<SplitLayout left={<div>left pane</div>} right={<div>right pane</div>} />);
    expect(screen.getByTestId('split-layout')).toBeTruthy();
    expect(screen.getByText('left pane')).toBeTruthy();
    expect(screen.getByText('right pane')).toBeTruthy();
    expect(screen.getByText('left pane').parentElement?.className).toBe('split-layout__left');
    expect(screen.getByText('right pane').parentElement?.className).toBe('split-layout__right');
  });
});
