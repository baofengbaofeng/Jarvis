import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { TaskControlBar } from './TaskControlBar';
import { useTaskStore } from '../../stores/task-store';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('TaskControlBar', () => {
  it('shows retry on failed state', () => {
    useTaskStore.setState({ status: 'failed' });
    render(<TaskControlBar />);
    expect(screen.getByTestId('task-retry')).toBeTruthy();
  });
  it('shows cancel and pause on running state', () => {
    useTaskStore.setState({ status: 'running' });
    render(<TaskControlBar />);
    expect(screen.getByTestId('task-cancel')).toBeTruthy();
    expect(screen.getByTestId('task-pause')).toBeTruthy();
  });
  it('shows resume on paused state', () => {
    useTaskStore.setState({ status: 'paused' });
    render(<TaskControlBar />);
    expect(screen.getByTestId('task-resume')).toBeTruthy();
  });
  it('hides when no task', () => {
    useTaskStore.setState({ status: null });
    const { container } = render(<TaskControlBar />);
    expect(container.querySelector('[data-testid="task-control"]')).toBeNull();
  });
  it('cancel button routes through the task store', () => {
    useTaskStore.setState({ status: 'running', activeTaskId: 't1' });
    const cancelSpy = useTaskStore.getState().cancel;
    let called = false;
    useTaskStore.setState({ cancel: async () => { called = true; } });
    render(<TaskControlBar />);
    fireEvent.click(screen.getByTestId('task-cancel'));
    expect(called).toBe(true);
    useTaskStore.setState({ cancel: cancelSpy });
  });
});
