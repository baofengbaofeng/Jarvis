import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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

// C5 (M8 Task 7): the persisted shortcut bindings fire GLOBALLY (the hook is
// mounted once here, next to the other app-root overlays). focus.input/chat.send
// focus the chat textarea when it is on the page (the chat route); from any
// other route they land the user on the chat page so the next press focuses.
function focusChatInput() {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]');
  if (el) { el.focus(); return; }
  window.location.href = '/';
}

export default function App() {
  const onboardingDone = useSettings((s) => s.onboardingDone);
  // C5 (M8 Task 7): one global keydown listener resolving the persisted
  // bindings (shortcuts.get) and dispatching the matching action. Mounted at the
  // app root so every page honors the bindings (the "在 App 内生效" acceptance).
  useShortcuts({
    'settings.open': () => { window.location.href = '/settings'; },
    'chat.new': () => { window.location.href = '/'; },
    'task.cancel': () => {
      const id = useTaskStore.getState().activeTaskId;
      if (id) void window.jarvis.invoke(IpcChannel.taskCancel, id);
    },
    'focus.input': focusChatInput,
    'chat.send': focusChatInput,
  });
  return (
    <ThemeProvider>
      <ErrorBoundary>
      <ApprovalModal />
      {/* D4 划词: a global mouseup floating overlay, so mount it once at the app
          root (next to the equally-global ApprovalModal) rather than per page. */}
      <SelectionMenu />
      {/* I5 (M6 Task 8): the in-app toast queue is global, so host it once at
          the root next to the other global overlays. */}
      <ToastHost />
      <BrowserRouter>
        {/* F15 (M6 Task 8): while a squad sits in_review the ApprovalPanel is
            shown; the squad-store clears it on approve/reject via the
            squad:status event. Rendered INSIDE the router so it can route-aware
            suppress itself on /squad — the squad view owns the F15 surface
            there and renders its own full-data panel (duplicating it would show
            two approve/reject control sets). */}
        <RootApprovalPanel />
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={onboardingDone ? <ChatPage /> : <Navigate to="/onboarding" replace />} />
            <Route path="/agents" element={<AgentListView />} />
            {/* L30 (M8 Task 8): agent template library — create a new agent from
                a preset. Top-level next to /agents; reached via the templates
                button on AgentListView. */}
            <Route path="/agents/templates" element={<AgentTemplatesPage />} />
            <Route path="/coding" element={<CodingPanelPage />} />
            <Route path="/office" element={<OfficePage />} />
            {/* K5/L14 (M6 Task 10): the squad view — timeline + call graph +
                ApprovalPanel driven by the FULL squad.current state. */}
            <Route path="/squad" element={<SquadViewPage />} />
            {/* K4 (M8 Task 1): six-column task kanban. */}
            <Route path="/board" element={<TaskBoardPage />} />
            {/* F10 (M8 Task 9): DAG workflow visual editor + runner. */}
            <Route path="/workflow" element={<WorkflowPage />} />
            {/* K6 (M8 Task 10): canvas workspace rendering task artifacts. */}
            <Route path="/canvas" element={<CanvasPage />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route path="providers" element={<ProviderSettingsPage />} />
              <Route path="mcp" element={<McpSettingsPage />} />
              <Route path="skills" element={<SkillsSettingsPage />} />
              <Route path="daemon" element={<DaemonManagementPage />} />
              <Route path="logs" element={<LogPanelPage />} />
              <Route path="permissions" element={<PermissionsSettingsPage />} />
              <Route path="env" element={<EnvSettingsPage />} />
              <Route path="concurrency" element={<ConcurrencySettingsPage />} />
              {/* M8 final review: wire the remaining M8 settings pages — L18/L20/J4
                  data safety, C12 config transfer, C5 shortcuts, B9 usage, J5 audit. */}
              <Route path="data-safety" element={<DataSafetyPage />} />
              <Route path="config" element={<ConfigImportExportView />} />
              <Route path="shortcuts" element={<ShortcutsSettingsView />} />
              <Route path="usage" element={<UsageDashboard />} />
              <Route path="audit" element={<AuditLogView />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

// F15 (M6 Task 8): the global approval panel rendered from useSquadStore.review,
// shown on every page while a squad sits in_review. On the /squad route the page
// owns the F15 surface (it drives the panel with FULL data via squad.current),
// so this root panel is suppressed there to avoid duplicate approve/reject
// controls (M6 Task 10 review finding).
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
