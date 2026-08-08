import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ThemeSwitcher } from './ThemeSwitcher';
import { useTheme } from './theme-store';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: getResources(),
    lng: 'zh-CN',
    ns: ['common'],
    defaultNS: 'common',
  });
});

beforeEach(() => {
  useTheme.setState({ mode: 'light' });
});

afterEach(() => {
  cleanup();
});

describe('ThemeSwitcher', () => {
  it('updates the theme store when a non-default mode is selected', () => {
    render(<ThemeSwitcher />);
    const select = screen.getByTestId('theme-select') as HTMLSelectElement;
    expect(select.value).toBe('light');
    fireEvent.change(select, { target: { value: 'dark' } });
    expect(useTheme.getState().mode).toBe('dark');
    expect((screen.getByTestId('theme-select') as HTMLSelectElement).value).toBe('dark');
    expect(screen.getByText('深色')).toBeTruthy();
  });

  it('can select system mode', () => {
    render(<ThemeSwitcher />);
    fireEvent.change(screen.getByTestId('theme-select'), { target: { value: 'system' } });
    expect(useTheme.getState().mode).toBe('system');
    expect((screen.getByTestId('theme-select') as HTMLSelectElement).value).toBe('system');
  });
});
