import { useSettings } from './settings-store';
import { initIpcSubscriptions } from './ipc-subscriptions';

export async function initRendererState(): Promise<void> {
  const bridge = window.jarvis;
  const lang = await bridge.settingsGet('language');
  const done = await bridge.settingsGet('onboarding_done');
  useSettings.setState({ language: (lang as string) ?? 'zh-CN', onboardingDone: done === true });
  if (lang) await import('i18next').then(m => m.default.changeLanguage(lang as string));
  initIpcSubscriptions();
}
