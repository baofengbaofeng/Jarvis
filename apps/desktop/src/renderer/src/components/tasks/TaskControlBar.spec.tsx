import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { TaskControlBar } from './TaskControlBar';
import { useTaskStore } from '../../stores/task-store';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('TaskControlBar', () => {
  it('shows retry on failed state', () => {
    useTaskStore.setState({ status: 'failed' });
    render(<TaskControlBar />);
    expect(screen.getByTestId('task-retry')).toBeTruthy();
  });
  it('hides when no task', () => {
    useTaskStore.setState({ status: null });
    const { container } = render(<TaskControlBar />);
    expect(container.querySelector('[data-testid="task-control"]')).toBeNull();
  });
});
