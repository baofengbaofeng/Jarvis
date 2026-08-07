import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NavItem } from '@jarvis/ui';
import { ThemeSwitcher } from '../components/theme/ThemeSwitcher';

export function SettingsLayout() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const link = (to: string, label: string) => {
    const active = pathname === to || pathname.startsWith(`${to}/`);
    return (
      <NavItem
        key={to}
        href={to}
        active={active}
        onClick={(e) => {
          e.preventDefault();
          void navigate(to);
        }}
      >
        {label}
      </NavItem>
    );
  };

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
