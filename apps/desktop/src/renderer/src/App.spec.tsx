import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import App from './App';

beforeAll(async () => {
  // jsdom does not implement window.matchMedia; the real ThemeProvider
  // (Task 7) reads it to resolve the 'system' theme, so stub it to "light".
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('App', () => {
  it('renders app title', () => {
    render(<App />);
    expect(screen.getByTestId('app-root')).toBeTruthy();
    expect(screen.getByText('JARVIS')).toBeTruthy();
  });
});
