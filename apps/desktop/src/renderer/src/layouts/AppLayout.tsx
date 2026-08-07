import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, GITHUB_REPO_URL } from '@jarvis/protocol';
import { AppShell, NavGroup, NavItem, Sidebar, TopBar } from '@jarvis/ui';
import { AgentSwitcher } from '../components/agents/AgentSwitcher';
import { TaskControlBar } from '../components/tasks/TaskControlBar';
import { ModeIndicator } from '../components/runtime/ModeIndicator';
import { useAgentStore } from '../stores/agent-store';
import { useChatStore } from '../stores/chat-store';
import { useRuntimeStore } from '../stores/runtime-store';

export function AppLayout() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { agents, current, refresh, setCurrent } = useAgentStore();
  const sessions = useChatStore((s) => s.sessions);
  const sessionId = useChatStore((s) => s.sessionId);
  const chatInit = useChatStore((s) => s.init);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const runtimeMode = useRuntimeStore((s) => s.status?.mode ?? 'local');

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void chatInit(); }, [chatInit]);

  const q = query.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    if (!q) return agents;
    return agents.filter(a =>
      a.name.toLowerCase().includes(q)
      || a.slug.toLowerCase().includes(q)
      || a.id.toLowerCase().includes(q)
    );
  }, [agents, q]);

  const filteredSessions = useMemo(() => {
    if (!q) return sessions;
    return sessions.filter(s =>
      (s.title || '').toLowerCase().includes(q)
      || s.id.toLowerCase().includes(q)
    );
  }, [sessions, q]);

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
                <strong data-testid="sidebar-brand-title">{t('app.title')} / {APP_VERSION}</strong>
                <p>{t('app.subtitle')}</p>
              </div>
            )}
            footer={(
              <div className="sidebar-app-footer">
                <span className="sidebar-app-footer__label">{t('app.title')} / {APP_VERSION}</span>
                <button
                  type="button"
                  className="sidebar-settings-gear"
                  data-testid="sidebar-settings-gear"
                  aria-label={t('shell.settingsAria')}
                  title={t('shell.settingsAria')}
                  onClick={() => void navigate('/settings/providers')}
                >
                  ⚙
                </button>
              </div>
            )}
          >
            <div className="sidebar-quick">
              <button
                type="button"
                className="sidebar-quick__btn"
                data-testid="sidebar-new-chat"
                onClick={() => {
                  void useChatStore.getState().newSession().then(() => {
                    void loadSessions();
                    void navigate('/');
                  });
                }}
              >
                <span aria-hidden="true">+</span> {t('shell.newChat')}
              </button>
              {searchOpen ? (
                <input
                  className="sidebar-search-input"
                  data-testid="sidebar-search-input"
                  type="search"
                  value={query}
                  placeholder={t('shell.searchPlaceholder')}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchOpen(false);
                      setQuery('');
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="sidebar-quick__btn"
                  data-testid="sidebar-search-toggle"
                  onClick={() => setSearchOpen(true)}
                >
                  <span aria-hidden="true">⌕</span> {t('shell.search')}
                </button>
              )}
            </div>

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

            <NavGroup label={t('shell.groupChats')}>
              {filteredSessions.map(s => (
                <NavItem
                  key={s.id}
                  href="/"
                  data-testid={`sidebar-chat-${s.id}`}
                  active={sessionId === s.id && pathname === '/'}
                  onClick={(e) => {
                    e.preventDefault();
                    void useChatStore.getState().loadSession(s.id);
                    void navigate('/');
                  }}
                >
                  {s.title || s.id}
                </NavItem>
              ))}
            </NavGroup>

            <NavGroup label={t('shell.groupMore')}>
              {item('/agents', 'nav-agents', t('menu.agents'), pathname.startsWith('/agents'))}
              {item('/board', 'nav-board', t('board.title'), pathname.startsWith('/board'))}
              {item('/coding', 'nav-coding', t('menu.coding'), pathname.startsWith('/coding'))}
              {item('/office', 'nav-office', t('menu.office'), pathname.startsWith('/office'))}
              {item('/squad', 'nav-squad', t('menu.squad'), pathname.startsWith('/squad'))}
              {item('/workflow', 'nav-workflow', t('workflow.title'), pathname.startsWith('/workflow'))}
              {item('/canvas', 'nav-canvas', t('canvas.title'), pathname.startsWith('/canvas'))}
            </NavGroup>
          </Sidebar>
        }
        topBar={(
          <TopBar
            left={<AgentSwitcher />}
            right={(
              <div className="topbar-actions">
                <ModeIndicator mode={runtimeMode} />
                <TaskControlBar />
              </div>
            )}
          />
        )}
        mainFooter={(
          <a
            className="shell-repo-link"
            data-testid="shell-repo-link"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={t('shell.repoLinkAria')}
          >
            {t('shell.repoLink')}
          </a>
        )}
      >
        <Outlet />
      </AppShell>
    </div>
  );
}
