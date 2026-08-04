import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './components/theme/ThemeProvider';
import { useSettings } from './stores/settings-store';
import { ChatPage } from './pages/ChatPage';
import { SettingsLayout } from './layouts/SettingsLayout';
import { ProviderSettingsPage } from './pages/settings/ProviderSettingsPage';
import { LogPanelPage } from './pages/settings/LogPanelPage';
import { McpSettingsPage } from './pages/settings/McpSettingsPage';
import { SkillsSettingsPage } from './pages/settings/SkillsSettingsPage';
import { PermissionsSettingsPage } from './pages/settings/PermissionsSettingsPage';
import { EnvSettingsPage } from './pages/settings/EnvSettingsPage';
import { ConcurrencySettingsPage } from './pages/settings/ConcurrencySettingsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { AgentListView } from './pages/AgentListView';
import { DaemonManagementPage } from './pages/DaemonManagementPage';

export default function App() {
  const onboardingDone = useSettings((s) => s.onboardingDone);
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={onboardingDone ? <ChatPage /> : <Navigate to="/onboarding" replace />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/agents" element={<AgentListView />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="providers" element={<ProviderSettingsPage />} />
            <Route path="mcp" element={<McpSettingsPage />} />
            <Route path="skills" element={<SkillsSettingsPage />} />
            <Route path="daemon" element={<DaemonManagementPage />} />
            <Route path="logs" element={<LogPanelPage />} />
            <Route path="permissions" element={<PermissionsSettingsPage />} />
            <Route path="env" element={<EnvSettingsPage />} />
            <Route path="concurrency" element={<ConcurrencySettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
