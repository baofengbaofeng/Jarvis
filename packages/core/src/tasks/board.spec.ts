import { describe, it, expect } from 'vitest';
import { groupByStatus, boardOrder, type TaskSummary } from './board';

const t = (id: string, status: TaskSummary['status'], createdAt: string): TaskSummary => ({ id, status, createdAt });

describe('groupByStatus', () => {
  it('groups by status and sorts each column by createdAt asc', () => {
    const cols = groupByStatus([
      t('c', 'completed', '2026-08-03T10:00:00Z'),
      t('a', 'running', '2026-08-03T09:00:00Z'),
      t('b', 'running', '2026-08-03T09:30:00Z'),
    ]);
    expect(cols.running.map(x => x.id)).toEqual(['a', 'b']);
    expect(cols.completed.map(x => x.id)).toEqual(['c']);
    expect(cols.queued).toEqual([]);
  });
  it('boardOrder defines the six kanban columns', () => {
    expect(boardOrder()).toEqual(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);
  });
});
