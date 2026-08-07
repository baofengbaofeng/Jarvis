import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './components/theme/ThemeProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useSettings } from './stores/settings-store';
import { ChatPage } from './pages/ChatPage';
import { AppLayout } from './layouts/AppLayout';
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
import { SquadViewPage } from './pages/SquadViewPage';
import { DaemonManagementPage } from './pages/DaemonManagementPage';
import { TaskBoardPage } from './pages/TaskBoardPage';
import { WorkflowPage } from './pages/WorkflowPage';
import { CanvasPage } from './pages/CanvasPage';
import { ApprovalModal } from './components/approval/ApprovalModal';
import { SelectionMenu } from './components/office/SelectionMenu';
import { ToastHost } from './components/squad/ToastHost';
import { ApprovalPanel } from './components/squad/ApprovalPanel';
import { DataSafetyPage } from './components/safety/DataSafetyPage';
import { ConfigImportExportView } from './components/settings/ConfigImportExportView';
import { ShortcutsSettingsView } from './components/settings/ShortcutsSettingsView';
import { UsageDashboard } from './components/usage/UsageDashboard';
import { AuditLogView } from './components/logs/AuditLogView';
import { AgentTemplatesPage } from './pages/AgentTemplatesPage';
import { useShortcuts } from './hooks/useShortcuts';
import { useTaskStore } from './stores/task-store';
import { useSquadStore } from './stores/squad-store';
import { IpcChannel } from '@jarvis/protocol';

function focusChatInput(navigate: ReturnType<typeof useNavigate>) {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]');
  if (el) { el.focus(); return; }
  void navigate('/');
}

function AppRoutes() {
  const onboardingDone = useSettings((s) => s.onboardingDone);
  const navigate = useNavigate();
  useShortcuts({
    'settings.open': () => { void navigate('/settings/providers'); },
    'chat.new': () => { void navigate('/'); },
    'task.cancel': () => {
      const id = useTaskStore.getState().activeTaskId;
      if (id) void window.jarvis.invoke(IpcChannel.taskCancel, id);
    },
    'focus.input': () => focusChatInput(navigate),
    'chat.send': () => focusChatInput(navigate),
  });

  return (
    <>
      <RootApprovalPanel />
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={onboardingDone ? <ChatPage /> : <Navigate to="/onboarding" replace />} />
          <Route path="/agents" element={<AgentListView />} />
          <Route path="/agents/templates" element={<AgentTemplatesPage />} />
          <Route path="/coding" element={<CodingPanelPage />} />
          <Route path="/office" element={<OfficePage />} />
          <Route path="/squad" element={<SquadViewPage />} />
          <Route path="/board" element={<TaskBoardPage />} />
          <Route path="/workflow" element={<WorkflowPage />} />
          <Route path="/canvas" element={<CanvasPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="providers" replace />} />
            <Route path="providers" element={<ProviderSettingsPage />} />
            <Route path="mcp" element={<McpSettingsPage />} />
            <Route path="skills" element={<SkillsSettingsPage />} />
            <Route path="daemon" element={<DaemonManagementPage />} />
            <Route path="logs" element={<LogPanelPage />} />
            <Route path="permissions" element={<PermissionsSettingsPage />} />
            <Route path="env" element={<EnvSettingsPage />} />
            <Route path="concurrency" element={<ConcurrencySettingsPage />} />
            <Route path="data-safety" element={<DataSafetyPage />} />
            <Route path="config" element={<ConfigImportExportView />} />
            <Route path="shortcuts" element={<ShortcutsSettingsView />} />
            <Route path="usage" element={<UsageDashboard />} />
            <Route path="audit" element={<AuditLogView />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}

function RootApprovalPanel() {
  const { pathname } = useLocation();
  const review = useSquadStore((s) => s.review);
  if (!review || pathname === '/squad') return null;
  return (
    <ApprovalPanel
      squadId={review.id}
      summary={review.summary}
      members={review.members}
      onDone={() => useSquadStore.getState().setReview(null)}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ApprovalModal />
        <SelectionMenu />
        <ToastHost />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
