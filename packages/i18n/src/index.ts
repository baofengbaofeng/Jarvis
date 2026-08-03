import zhCommon from '../locales/zh-CN/common.json';
import enCommon from '../locales/en/common.json';

// Type alias (not interface) so the object literal gets an implicit index
// signature, making it assignable to i18next's `Resource` in i18n.init().
export type I18nResources = {
  'zh-CN': { common: Record<string, unknown> };
  en: { common: Record<string, unknown> };
};

export function getResources(): I18nResources {
  return {
    'zh-CN': { common: zhCommon as Record<string, unknown> },
    en: { common: enCommon as Record<string, unknown> },
  };
}

export function getLocales(): Array<'zh-CN' | 'en'> {
  return ['zh-CN', 'en'];
}
