import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useSettings } from '../stores/settings-store';
import { installMockJarvis } from '../test/mockJarvis';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: getResources(),
    lng: 'zh-CN',
    ns: ['common'],
    defaultNS: 'common',
  });
});

afterEach(() => {
  cleanup();
  useSettings.setState({
    language: 'zh-CN',
    setLanguage: async (lang: string) => {
      useSettings.setState({ language: lang });
      await window.jarvis.settingsSet('language', lang);
    },
  });
});

describe('LanguageSwitcher', () => {
  it('persists a non-default language via settingsSet', async () => {
    const jarvis = installMockJarvis();
    const setLanguage = vi.fn(async (lang: string) => {
      useSettings.setState({ language: lang });
      await jarvis.settingsSet('language', lang);
    });
    useSettings.setState({ language: 'zh-CN', setLanguage });

    render(<LanguageSwitcher />);
    const select = screen.getByTestId('language-switcher') as HTMLSelectElement;
    expect(select.value).toBe('zh-CN');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => {
      expect(setLanguage).toHaveBeenCalledWith('en');
      expect(jarvis.settingsSet).toHaveBeenCalledWith('language', 'en');
      expect(useSettings.getState().language).toBe('en');
    });
    expect((screen.getByTestId('language-switcher') as HTMLSelectElement).value).toBe('en');
  });
});
