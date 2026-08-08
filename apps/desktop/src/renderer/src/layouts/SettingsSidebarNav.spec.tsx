import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { SettingsSidebarNav } from './SettingsSidebarNav';

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
});

function renderNav(path = '/settings/providers') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/*" element={<SettingsSidebarNav />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsSidebarNav', () => {
  it('renders icons on every settings nav link', () => {
    renderNav();
    const ids = [
      'settings-nav-providers',
      'settings-nav-mcp',
      'settings-nav-skills',
      'settings-nav-daemon',
      'settings-nav-concurrency',
      'settings-nav-logs',
      'settings-nav-permissions',
      'settings-nav-env',
      'settings-nav-data-safety',
      'settings-nav-config',
      'settings-nav-usage',
      'settings-nav-audit',
      'settings-nav-shortcuts',
    ];
    for (const id of ids) {
      expect(screen.getByTestId(id).querySelector('.shell-icon')).toBeTruthy();
    }
  });

  it('marks the active settings route', () => {
    renderNav('/settings/mcp');
    expect(screen.getByTestId('settings-nav-mcp').className).toMatch(/active/);
    expect(screen.getByTestId('settings-nav-providers').className).not.toMatch(/active/);
  });
});
