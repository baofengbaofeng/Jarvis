import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { AppLayout } from './AppLayout';

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  });
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: vi.fn(async () => []),
    onDidReceive: () => () => {}
  };
});

describe('AppLayout', () => {
  it('renders shell nav targets', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div data-testid="child">child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('app-shell')).toBeTruthy();
    expect(screen.getByTestId('nav-chat')).toBeTruthy();
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});
