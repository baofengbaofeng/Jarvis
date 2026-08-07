import { useTranslation } from 'react-i18next';
import { Select } from '@jarvis/ui';
import { useSettings } from '../stores/settings-store';

export function LanguageSwitcher() {
  const { i18n } = useTranslation('common');
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <Select
      className="jui-select--inline"
      data-testid="language-switcher"
      value={language}
      onChange={async (e) => {
        const lang = e.target.value;
        await setLanguage(lang);
        await i18n.changeLanguage(lang);
        document.documentElement.lang = lang;
      }}
    >
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
    </Select>
  );
}
