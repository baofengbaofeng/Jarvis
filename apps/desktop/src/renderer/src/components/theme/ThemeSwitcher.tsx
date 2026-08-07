import { useTranslation } from 'react-i18next';
import { Select } from '@jarvis/ui';
import { useTheme, type ThemeMode } from './theme-store';

export function ThemeSwitcher() {
  const { t } = useTranslation('common');
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);

  return (
    <div className="theme-switcher" data-testid="theme-switcher">
      <span className="theme-switcher__label">{t('settings.nav.appearance')}</span>
      <Select
        data-testid="theme-select"
        value={mode}
        onChange={(e) => setMode(e.target.value as ThemeMode)}
      >
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
        <option value="system">{t('theme.system')}</option>
      </Select>
    </div>
  );
}
