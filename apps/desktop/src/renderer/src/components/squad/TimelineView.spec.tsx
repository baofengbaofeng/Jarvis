import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { TimelineView } from './TimelineView';
import { pushSquadEvent, clearSquadEvents } from '../../stores/squad-store';

describe('TimelineView', () => {
  afterEach(() => { cleanup(); clearSquadEvents(); });

  it('renders pushed events', () => {
    render(<TimelineView />);
    // pushSquadEvent fires the store's listeners synchronously, but React 18/19
    // batches the resulting setState — wrap in act() so the DOM reflects it
    // before the query (plain synchronous pushes would leave the list empty).
    act(() => { pushSquadEvent({ agent: 'leader', ts: Date.now(), kind: 'start', detail: 'delegating' }); });
    expect(screen.getByTestId('timeline-start')).toBeTruthy();
  });

  it('capped at 200 events', () => {
    render(<TimelineView />);
    act(() => {
      for (let i = 0; i < 250; i++) pushSquadEvent({ agent: 'a', ts: i, kind: 'log', detail: String(i) });
    });
    // The DOM only renders events 50..249 (the last 200 pushed).
    expect(screen.getAllByTestId('timeline-log')).toHaveLength(200);
  });
});
