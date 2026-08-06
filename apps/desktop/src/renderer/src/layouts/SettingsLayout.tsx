import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function SettingsLayout() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="settings-layout" style={{ display: 'flex', minHeight: '100%' }}>
      <nav style={{ width: 200, borderRight: '1px solid var(--border)', padding: 16 }}>
        <NavLink to="/settings/providers">{t('settings.nav.providers')}</NavLink>
        <NavLink to="/settings/mcp">{t('settings.nav.mcp')}</NavLink>
        <NavLink to="/settings/skills">{t('settings.nav.skills')}</NavLink>
        <NavLink to="/settings/daemon">{t('settings.nav.daemon')}</NavLink>
        <NavLink to="/settings/logs">{t('settings.nav.logs')}</NavLink>
        <NavLink to="/settings/permissions">{t('settings.nav.permissions')}</NavLink>
        <NavLink to="/settings/env">{t('settings.nav.env')}</NavLink>
        <NavLink to="/settings/concurrency">{t('settings.nav.concurrency')}</NavLink>
        {/* M8 final review: the M8 settings pages (L18/L20/J4 safety, C12 config,
            C5 shortcuts, B9 usage, J5 audit) need nav entries to be reachable. */}
        <NavLink to="/settings/data-safety">{t('settings.nav.dataSafety')}</NavLink>
        <NavLink to="/settings/config">{t('settings.nav.config')}</NavLink>
        <NavLink to="/settings/shortcuts">{t('settings.nav.shortcuts')}</NavLink>
        <NavLink to="/settings/usage">{t('settings.nav.usage')}</NavLink>
        <NavLink to="/settings/audit">{t('settings.nav.audit')}</NavLink>
        <LanguageSwitcher />
      </nav>
      <main style={{ flex: 1, padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
