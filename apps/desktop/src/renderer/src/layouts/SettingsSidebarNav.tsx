import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CollapsibleNavGroup, NavItem } from '@jarvis/ui';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeSwitcher } from '../components/theme/ThemeSwitcher';
import {
  IconChart,
  IconClipboardList,
  IconCloud,
  IconDatabase,
  IconGlobe,
  IconKeyboard,
  IconLayers,
  IconPackage,
  IconPalette,
  IconPlug,
  IconScrollText,
  IconServer,
  IconShield,
  IconSparkles,
  IconTerminal,
} from '../components/shell/ShellIcons';

function NavLabel({ children }: { children: ReactNode }) {
  return <span className="jui-navitem__label sidebar-label">{children}</span>;
}

export function SettingsSidebarNav() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const link = (to: string, label: string, icon: ReactNode, testId: string) => {
    const active = pathname === to || pathname.startsWith(`${to}/`);
    return (
      <NavItem
        key={to}
        href={to}
        data-testid={testId}
        active={active}
        title={label}
        onClick={(e) => {
          e.preventDefault();
          void navigate(to);
        }}
      >
        {icon}
        <NavLabel>{label}</NavLabel>
      </NavItem>
    );
  };

  return (
    <nav className="settings-sidebar-nav" data-testid="settings-sidebar-nav">
      <CollapsibleNavGroup label={t('settings.nav.groups.ai')}>
        {link('/settings/providers', t('settings.nav.providers'), <IconCloud />, 'settings-nav-providers')}
        {link('/settings/mcp', t('settings.nav.mcp'), <IconPlug />, 'settings-nav-mcp')}
        {link('/settings/skills', t('settings.nav.skills'), <IconSparkles />, 'settings-nav-skills')}
      </CollapsibleNavGroup>
      <CollapsibleNavGroup label={t('settings.nav.groups.runtime')}>
        {link('/settings/daemon', t('settings.nav.daemon'), <IconServer />, 'settings-nav-daemon')}
        {link('/settings/concurrency', t('settings.nav.concurrency'), <IconLayers />, 'settings-nav-concurrency')}
        {link('/settings/logs', t('settings.nav.logs'), <IconScrollText />, 'settings-nav-logs')}
      </CollapsibleNavGroup>
      <CollapsibleNavGroup label={t('settings.nav.groups.agent')}>
        {link('/settings/permissions', t('settings.nav.permissions'), <IconShield />, 'settings-nav-permissions')}
        {link('/settings/env', t('settings.nav.env'), <IconTerminal />, 'settings-nav-env')}
      </CollapsibleNavGroup>
      <CollapsibleNavGroup label={t('settings.nav.groups.data')}>
        {link('/settings/data-safety', t('settings.nav.dataSafety'), <IconDatabase />, 'settings-nav-data-safety')}
        {link('/settings/config', t('settings.nav.config'), <IconPackage />, 'settings-nav-config')}
        {link('/settings/usage', t('settings.nav.usage'), <IconChart />, 'settings-nav-usage')}
        {link('/settings/audit', t('settings.nav.audit'), <IconClipboardList />, 'settings-nav-audit')}
      </CollapsibleNavGroup>
      <CollapsibleNavGroup label={t('settings.nav.groups.preferences')}>
        {link('/settings/shortcuts', t('settings.nav.shortcuts'), <IconKeyboard />, 'settings-nav-shortcuts')}
        <div className="settings-sidebar-nav__prefs">
          <div className="settings-sidebar-nav__pref-row" data-testid="settings-nav-appearance">
            <IconPalette />
            <ThemeSwitcher />
          </div>
          <div className="settings-sidebar-nav__pref-row" data-testid="settings-nav-language">
            <IconGlobe />
            <LanguageSwitcher />
          </div>
        </div>
      </CollapsibleNavGroup>
    </nav>
  );
}
