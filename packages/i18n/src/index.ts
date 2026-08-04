import zhCommon from '../locales/zh-CN/common.json';
import enCommon from '../locales/en/common.json';

// Concrete JSON-derived types (no `Record<string, unknown>` casts) so that
// `res['zh-CN'].common.app.title` typechecks under `strict`.
export type I18nResources = {
  'zh-CN': { common: typeof zhCommon };
  en: { common: typeof enCommon };
};

export function getResources(): I18nResources {
  return { 'zh-CN': { common: zhCommon }, en: { common: enCommon } };
}

export function getLocales(): Array<'zh-CN' | 'en'> {
  return ['zh-CN', 'en'];
}
