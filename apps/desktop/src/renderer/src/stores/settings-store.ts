import { create } from 'zustand';

interface SettingsState {
  language: string;
  onboardingDone: boolean;
  setLanguage: (lang: string) => Promise<void>;
  setOnboardingDone: (done: boolean) => Promise<void>;
}

export function createSettingsStore(bridge: {
  settingsGet: (key: string) => Promise<unknown>;
  settingsSet: (key: string, value: unknown) => Promise<void>;
}) {
  return create<SettingsState>((set) => ({
    language: 'zh-CN',
    onboardingDone: false,
    async setLanguage(lang) {
      set({ language: lang });
      await bridge.settingsSet('language', lang);
    },
    async setOnboardingDone(done) {
      set({ onboardingDone: done });
      await bridge.settingsSet('onboarding_done', done);
    }
  }));
}

export const useSettings = createSettingsStore(window.jarvis);
