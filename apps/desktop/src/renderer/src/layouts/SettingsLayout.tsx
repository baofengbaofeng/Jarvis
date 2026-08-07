import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeSwitcher } from '../components/theme/ThemeSwitcher';

export function SettingsLayout() {
  const { t } = useTranslation('common');
  const link = (to: string, label: string) => (
    <NavLink key={to} to={to}>{label}</NavLink>
  );

  return (
    <div data-testid="settings-layout" className="settings-layout">
      <nav className="settings-layout__nav">
        {link('/settings/providers', t('settings.nav.providers'))}
        {link('/settings/mcp', t('settings.nav.mcp'))}
        {link('/settings/skills', t('settings.nav.skills'))}
        {link('/settings/daemon', t('settings.nav.daemon'))}
        {link('/settings/logs', t('settings.nav.logs'))}
        {link('/settings/permissions', t('settings.nav.permissions'))}
        {link('/settings/env', t('settings.nav.env'))}
        {link('/settings/concurrency', t('settings.nav.concurrency'))}
        {link('/settings/data-safety', t('settings.nav.dataSafety'))}
        {link('/settings/config', t('settings.nav.config'))}
        {link('/settings/shortcuts', t('settings.nav.shortcuts'))}
        {link('/settings/usage', t('settings.nav.usage'))}
        {link('/settings/audit', t('settings.nav.audit'))}
        <ThemeSwitcher />
      </nav>
      <main className="settings-layout__main">
        <Outlet />
      </main>
    </div>
  );
}
