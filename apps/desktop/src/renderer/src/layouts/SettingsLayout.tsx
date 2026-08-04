import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function SettingsLayout() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="settings-layout" style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, borderRight: '1px solid var(--border)', padding: 16 }}>
        <NavLink to="/settings/providers">{t('settings.nav.providers')}</NavLink>
        <NavLink to="/settings/logs">{t('settings.nav.logs')}</NavLink>
        <LanguageSwitcher />
      </nav>
      <main style={{ flex: 1, padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
