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
import { OfficePage } from './pages/OfficePage';
import { CodingPanelPage } from './pages/CodingPanelPage';
import { AgentListView } from './pages/AgentListView';
import { DaemonManagementPage } from './pages/DaemonManagementPage';
import { ApprovalModal } from './components/approval/ApprovalModal';
import { SelectionMenu } from './components/office/SelectionMenu';
import { ToastHost } from './components/squad/ToastHost';
import { ApprovalPanel } from './components/squad/ApprovalPanel';
import { useSquadStore } from './stores/squad-store';

export default function App() {
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const review = useSquadStore((s) => s.review);
  return (
    <ThemeProvider>
      <ApprovalModal />
      {/* D4 划词: a global mouseup floating overlay, so mount it once at the app
          root (next to the equally-global ApprovalModal) rather than per page. */}
      <SelectionMenu />
      {/* I5 (M6 Task 8): the in-app toast queue is global, so host it once at
          the root next to the other global overlays. */}
      <ToastHost />
      {/* F15 (M6 Task 8): while a squad sits in_review the ApprovalPanel is
          shown; the squad-store clears it on approve/reject via the
          squad:status event. Task 10's squad view will drive start(). */}
      {review && (
        <ApprovalPanel
          squadId={review.id}
          summary={review.summary}
          members={review.members}
          onDone={() => useSquadStore.getState().setReview(null)}
        />
      )}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={onboardingDone ? <ChatPage /> : <Navigate to="/onboarding" replace />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/agents" element={<AgentListView />} />
          <Route path="/coding" element={<CodingPanelPage />} />
          <Route path="/office" element={<OfficePage />} />
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
