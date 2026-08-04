import { ChatPage } from './pages/ChatPage';
import { SettingsLayout } from './layouts/SettingsLayout';
import { ProviderSettingsPage } from './pages/settings/ProviderSettingsPage';
import { LogPanelPage } from './pages/settings/LogPanelPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DaemonManagementPage } from './pages/DaemonManagementPage';

// 使用简单对象路由表;M1+ 若需要可切换 TanStack Router 文件路由
export const routes = {
  '/': ChatPage,
  '/settings': SettingsLayout,
  '/settings/providers': ProviderSettingsPage,
  '/settings/daemon': DaemonManagementPage,
  '/settings/logs': LogPanelPage,
  '/onboarding': OnboardingPage
} as const;
