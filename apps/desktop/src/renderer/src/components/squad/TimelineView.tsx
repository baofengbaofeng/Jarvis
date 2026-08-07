import { useEffect } from 'react';
import { subscribeSquadEvents, type SquadEvent } from '../../stores/squad-store';
import { useState } from 'react';
import { StepCard } from '@jarvis/ui';

const KIND_STATUS: Record<string, 'pending' | 'running' | 'success' | 'warning'> = {
  delegate: 'running',
  response: 'success',
  complete: 'success',
  request: 'warning',
  log: 'pending',
  start: 'running',
};

export function TimelineView() {
  const [events, setEvents] = useState<SquadEvent[]>([]);
  useEffect(() => subscribeSquadEvents(setEvents), []);
  return (
    <div data-testid="timeline" className="timeline">
      {events.map((e, i) => (
        <StepCard
          key={`${e.ts}-${i}`}
          title={`${e.agent} · ${e.kind}`}
          status={KIND_STATUS[e.kind] ?? 'pending'}
          defaultOpen={e.kind === 'request'}
        >
          <div className="timeline__item" data-testid={`timeline-${e.kind}`}>
            <span className="timeline__time">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="timeline__body">{e.detail}</span>
          </div>
        </StepCard>
      ))}
    </div>
  );
}
