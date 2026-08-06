import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell, NavGroup, NavItem, Sidebar, TopBar } from '@jarvis/ui';
import { AgentSwitcher } from '../components/agents/AgentSwitcher';
import { TaskControlBar } from '../components/tasks/TaskControlBar';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function AppLayout() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const item = (to: string, tid: string, label: string, active: boolean) => (
    <NavItem
      key={to}
      href={to}
      data-testid={tid}
      active={active}
      onClick={(e) => {
        e.preventDefault();
        void navigate(to);
      }}
    >
      {label}
    </NavItem>
  );

  return (
    <div data-testid="app-shell" style={{ height: '100%' }}>
      <AppShell
        sidebar={
          <Sidebar brand={<strong>{t('app.title')}</strong>} footer={<LanguageSwitcher />}>
            <NavGroup label={t('shell.groupWork')}>
              {item('/', 'nav-chat', t('shell.navChat'), pathname === '/')}
              {item('/agents', 'nav-agents', t('menu.agents'), pathname.startsWith('/agents'))}
              {item('/coding', 'nav-coding', t('menu.coding'), pathname.startsWith('/coding'))}
              {item('/office', 'nav-office', t('menu.office'), pathname.startsWith('/office'))}
            </NavGroup>
            <NavGroup label={t('shell.groupCollab')}>
              {item('/squad', 'nav-squad', t('menu.squad'), pathname.startsWith('/squad'))}
              {item('/board', 'nav-board', t('board.title'), pathname.startsWith('/board'))}
              {item('/workflow', 'nav-workflow', t('workflow.title'), pathname.startsWith('/workflow'))}
              {item('/canvas', 'nav-canvas', t('canvas.title'), pathname.startsWith('/canvas'))}
            </NavGroup>
            <div style={{ marginTop: 'auto' }}>
              {item('/settings/providers', 'nav-settings', t('menu.settings'), pathname.startsWith('/settings'))}
            </div>
          </Sidebar>
        }
        topBar={<TopBar left={<AgentSwitcher />} right={<TaskControlBar />} />}
      >
        <Outlet />
      </AppShell>
    </div>
  );
}
