import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TaskBoard } from './TaskBoard';

const tasks = [
  { id: 't1', status: 'running', createdAt: '2026-08-03T09:00:00Z' },
  { id: 't2', status: 'failed', createdAt: '2026-08-03T10:00:00Z', error: 'boom' },
];
const invoke = vi.fn(async (m: string) => { if (m === 'taskboard.list') return tasks; return undefined; });

beforeEach(() => { (window as any).jarvis = { invoke }; });

afterEach(() => { cleanup(); });

describe('TaskBoard', () => {
  it('renders six columns and places tasks by status', async () => {
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByTestId('col-running')).toBeTruthy());
    expect(screen.getByText('t1')).toBeTruthy();
    expect(screen.getByText('t2')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });
  it('calls task.retry on failed card', async () => {
    render(<TaskBoard />);
    await waitFor(() => expect(screen.getByText('↻')).toBeTruthy());
    fireEvent.click(screen.getByText('↻'));
    expect(invoke).toHaveBeenCalledWith('task.retry', 't2');
  });
});
