import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { PlanModeBadge } from './PlanModeBadge';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('PlanModeBadge', () => {
  it('renders nothing when not in plan mode', () => {
    render(<PlanModeBadge active={false} />);
    expect(screen.queryByTestId('plan-badge')).toBeNull();
  });

  it('renders the plan badge when active', () => {
    render(<PlanModeBadge active />);
    expect(screen.getByTestId('plan-badge').textContent).toBe('Plan');
  });
});
