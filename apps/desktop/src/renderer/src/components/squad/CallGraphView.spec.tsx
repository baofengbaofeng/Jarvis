import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CallGraphView } from './CallGraphView';

// L14 (M6 Task 10): smoke test — react-flow in jsdom can be flaky (it needs
// ResizeObserver/DOMRect the jsdom environment may not fully provide), so this
// only asserts the container is present with empty rows; richer graph rendering
// is manually verified in the running app.
describe('CallGraphView', () => {
  afterEach(() => { cleanup(); });

  it('renders the call-graph container with empty rows', () => {
    render(<CallGraphView rows={[]} />);
    expect(screen.getByTestId('call-graph')).toBeTruthy();
  });
});
