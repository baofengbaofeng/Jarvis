import { useEffect, useState } from 'react';
import { subscribeSquadEvents, type SquadEvent } from '../../stores/squad-store';

// K5 (M6 Task 10): the squad execution timeline / log stream. Subscribes to the
// module-level squad event log (fed by main's 'squad:event' push) and renders
// each event as a time-stamped line — the S5 acceptance surface for the
// Leader → delegate_agent → member → bus → summary → in_review journey.
export function TimelineView() {
  const [events, setEvents] = useState<SquadEvent[]>([]);
  useEffect(() => subscribeSquadEvents(setEvents), []);
  return (
    <ul data-testid="timeline" className="timeline">
      {events.map((e, i) => (
        <li key={i} data-testid={`timeline-${e.kind}`} className="timeline__item">
          <span className="timeline__time">{new Date(e.ts).toLocaleTimeString()}</span>
          <span className="timeline__agent">{e.agent}</span> {e.detail}
        </li>
      ))}
    </ul>
  );
}
