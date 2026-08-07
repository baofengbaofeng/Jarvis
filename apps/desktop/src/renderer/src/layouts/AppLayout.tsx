import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell, NavGroup, NavItem, SearchInput, Sidebar, TopBar } from '@jarvis/ui';
import { AgentSwitcher } from '../components/agents/AgentSwitcher';
import { TaskControlBar } from '../components/tasks/TaskControlBar';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ModeIndicator } from '../components/runtime/ModeIndicator';
import { useAgentStore } from '../stores/agent-store';

export function AppLayout() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const { agents, current, refresh, setCurrent } = useAgentStore();

  useEffect(() => { void refresh(); }, [refresh]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(a => a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q));
  }, [agents, query]);

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
    <div data-testid="app-shell" className="app-shell-root">
      <AppShell
        sidebar={
          <Sidebar
            brand={(
              <div className="sidebar-brand">
                <strong>{t('app.title')}</strong>
                <p>{t('app.subtitle')}</p>
              </div>
            )}
            footer={<LanguageSwitcher />}
          >
            <div className="sidebar-search">
              <SearchInput
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('shell.searchAgents')}
                onClear={() => setQuery('')}
              />
            </div>
            <NavGroup label={t('shell.groupWork')}>
              {item('/', 'nav-chat', t('shell.navChat'), pathname === '/')}
              {item('/agents', 'nav-agents', t('menu.agents'), pathname.startsWith('/agents'))}
              {item('/board', 'nav-board', t('board.title'), pathname.startsWith('/board'))}
              {item('/coding', 'nav-coding', t('menu.coding'), pathname.startsWith('/coding'))}
              {item('/office', 'nav-office', t('menu.office'), pathname.startsWith('/office'))}
            </NavGroup>
            <NavGroup label={t('shell.groupCollab')}>
              {item('/squad', 'nav-squad', t('menu.squad'), pathname.startsWith('/squad'))}
              {item('/workflow', 'nav-workflow', t('workflow.title'), pathname.startsWith('/workflow'))}
              {item('/canvas', 'nav-canvas', t('canvas.title'), pathname.startsWith('/canvas'))}
            </NavGroup>
            {filteredAgents.length > 0 && (
              <NavGroup label={t('shell.groupAgents')}>
                {filteredAgents.map(a => (
                  <NavItem
                    key={a.id}
                    href="/"
                    data-testid={`sidebar-agent-${a.slug}`}
                    active={current?.id === a.id && pathname === '/'}
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrent(a);
                      void navigate('/');
                    }}
                  >
                    {a.name}
                  </NavItem>
                ))}
              </NavGroup>
            )}
            <div className="sidebar-footer">
              {item('/settings/providers', 'nav-settings', t('menu.settings'), pathname.startsWith('/settings'))}
            </div>
          </Sidebar>
        }
        topBar={(
          <TopBar
            left={<AgentSwitcher />}
            right={(
              <div className="topbar-actions">
                <ModeIndicator />
                <TaskControlBar />
              </div>
            )}
          />
        )}
      >
        <Outlet />
      </AppShell>
    </div>
  );
}
