import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, GITHUB_ISSUES_URL, GITHUB_WIKI_URL } from '@jarvis/protocol';
import { AppShell, Button, Modal, NavGroup, NavItem, Sidebar, TopBar } from '@jarvis/ui';
import { AgentSwitcher } from '../components/agents/AgentSwitcher';
import { TaskControlBar } from '../components/tasks/TaskControlBar';
import { ModeIndicator } from '../components/runtime/ModeIndicator';
import { ShellSearchPalette } from '../components/shell/ShellSearchPalette';
import {
  IconArrowLeft,
  IconBoard,
  IconBot,
  IconCanvas,
  IconCode,
  IconFile,
  IconMessage,
  IconMessagePlus,
  IconPanel,
  IconPin,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUsers,
  IconWorkflow,
} from '../components/shell/ShellIcons';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useSidebarChrome } from '../hooks/useSidebarChrome';
import { useWindowChrome } from '../hooks/useWindowChrome';
import { useAgentStore } from '../stores/agent-store';
import { useChatStore } from '../stores/chat-store';
import { useRuntimeStore } from '../stores/runtime-store';
import { SettingsSidebarNav } from './SettingsSidebarNav';

function NavLabel({ children }: { children: ReactNode }) {
  return <span className="jui-navitem__label sidebar-label">{children}</span>;
}

export function AppLayout() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameCommittedRef = useRef(false);
  const { agents, current, refresh, setCurrent } = useAgentStore();
  const sessions = useChatStore((s) => s.sessions);
  const sessionId = useChatStore((s) => s.sessionId);
  const chatInit = useChatStore((s) => s.init);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const runtimeMode = useRuntimeStore((s) => s.status?.mode ?? 'local');
  const { fullscreen, titleInset } = useWindowChrome();
  const {
    isAgentPinned,
    isChatPinned,
    toggleAgentPin,
    toggleChatPin,
    sortByPinned,
  } = usePinnedItems();
  const {
    collapsed,
    effectiveWidth,
    toggleCollapsed,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
  } = useSidebarChrome();
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void chatInit(); }, [chatInit]);

  const sortedAgents = sortByPinned(agents, 'agent');
  const sortedSessions = sortByPinned(sessions, 'chat');
  const inSettings = pathname.startsWith('/settings');

  const item = (
    to: string,
    tid: string,
    label: string,
    active: boolean,
    icon: ReactNode,
  ) => (
    <NavItem
      key={to}
      href={to}
      data-testid={tid}
      active={active}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        void navigate(to);
      }}
    >
      {icon}
      <NavLabel>{label}</NavLabel>
    </NavItem>
  );

  return (
    <div
      data-testid="app-shell"
      className={[
        'app-shell-root',
        collapsed ? 'app-shell-root--sidebar-collapsed' : '',
        fullscreen ? 'app-shell-root--fullscreen' : '',
        inSettings ? 'app-shell-root--settings' : '',
      ].filter(Boolean).join(' ')}
      style={{
        ['--shell-sidebar-width' as string]: `${effectiveWidth}px`,
        /* Collapse control inset — stays put whether menus are open or closed. */
        ['--shell-title-inset' as string]: `${titleInset}px`,
      }}
    >
      {/* Fixed next to traffic lights; does not collapse with the menu column. */}
      <div className="window-title-chrome" data-testid="window-title-chrome">
        <button
          type="button"
          className="sidebar-collapse-btn"
          data-testid="sidebar-collapse-toggle"
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          aria-expanded={!collapsed}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleCollapsed}
        >
          <IconPanel />
        </button>
      </div>
      <AppShell
        sidebar={
          <div className="sidebar-chrome" data-testid="sidebar-chrome">
            {!collapsed && (
              <>
            <div
              className={`sidebar-titlebar${inSettings ? ' sidebar-titlebar--settings' : ''}`}
              data-testid="sidebar-titlebar"
              aria-hidden={inSettings ? undefined : true}
            >
              {inSettings ? (
                <button
                  type="button"
                  className="settings-titlebar-back"
                  data-testid="settings-back"
                  aria-label={t('shell.backToApp')}
                  title={t('shell.backToApp')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => void navigate('/')}
                >
                  <IconArrowLeft />
                </button>
              ) : null}
            </div>
            <Sidebar
              footer={(
                <div className="sidebar-app-footer">
                  <span className="sidebar-app-footer__label sidebar-label" data-testid="sidebar-footer-title">
                    {t('app.title')} / {t('shell.currentVersion')}{APP_VERSION}
                  </span>
                  <button
                    type="button"
                    className="sidebar-settings-gear"
                    data-testid="sidebar-settings-gear"
                    aria-label={inSettings ? t('shell.backToApp') : t('shell.settingsAria')}
                    title={inSettings ? t('shell.backToApp') : t('shell.settingsAria')}
                    onClick={() => void navigate(inSettings ? '/' : '/settings/providers')}
                  >
                    <IconSettings />
                  </button>
                </div>
              )}
            >
              {inSettings ? (
                <SettingsSidebarNav />
              ) : (
                <>
              <div className="sidebar-quick">
                <button
                  type="button"
                  className="sidebar-quick__btn"
                  data-testid="sidebar-new-chat"
                  title={t('shell.newChat')}
                  onClick={() => {
                    void useChatStore.getState().newSession().then(() => {
                      void loadSessions();
                      void navigate('/');
                    });
                  }}
                >
                  <IconMessagePlus />
                  <span className="sidebar-label">{t('shell.newChat')}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-quick__btn"
                  data-testid="sidebar-search-toggle"
                  title={t('shell.search')}
                  onClick={() => setSearchOpen(true)}
                >
                  <IconSearch />
                  <span className="sidebar-label">{t('shell.search')}</span>
                </button>
              </div>

              <NavGroup label={t('shell.groupAgents')}>
                {sortedAgents.map(a => {
                  const pinned = isAgentPinned(a.id);
                  return (
                    <div
                      key={a.id}
                      className={`sidebar-pin-row${pinned ? ' sidebar-pin-row--pinned' : ''}`}
                      data-testid={`sidebar-agent-row-${a.slug}`}
                    >
                      <NavItem
                        href="/"
                        data-testid={`sidebar-agent-${a.slug}`}
                        active={current?.id === a.id && pathname === '/'}
                        title={a.name}
                        onClick={(e) => {
                          e.preventDefault();
                          setCurrent(a);
                          void navigate('/');
                        }}
                      >
                        <IconBot />
                        <NavLabel>{a.name}</NavLabel>
                      </NavItem>
                      <button
                        type="button"
                        className={`sidebar-pin-btn${pinned ? ' sidebar-pin-btn--on' : ''}`}
                        data-testid={`sidebar-agent-pin-${a.slug}`}
                        aria-label={pinned ? t('shell.unpin') : t('shell.pin')}
                        aria-pressed={pinned}
                        title={pinned ? t('shell.unpin') : t('shell.pin')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleAgentPin(a.id);
                        }}
                      >
                        <IconPin />
                      </button>
                    </div>
                  );
                })}
              </NavGroup>

              <NavGroup label={t('shell.groupChats')}>
                {sortedSessions.map(s => {
                  const pinned = isChatPinned(s.id);
                  const title = s.title || s.id;
                  const renaming = renamingChatId === s.id;
                  const startRename = () => {
                    renameCommittedRef.current = false;
                    setRenamingChatId(s.id);
                    setRenameDraft(title);
                  };
                  const cancelRename = () => {
                    renameCommittedRef.current = true;
                    setRenamingChatId(null);
                  };
                  const commitRename = () => {
                    if (renameCommittedRef.current || renamingChatId !== s.id) return;
                    renameCommittedRef.current = true;
                    const next = renameDraft.trim();
                    setRenamingChatId(null);
                    if (!next || next === title) return;
                    void useChatStore.getState().renameSession(s.id, next);
                  };
                  return (
                    <div
                      key={s.id}
                      className={`sidebar-chat-row sidebar-pin-row${pinned ? ' sidebar-pin-row--pinned' : ''}${renaming ? ' sidebar-chat-row--renaming' : ''}`}
                      data-testid={`sidebar-chat-row-${s.id}`}
                    >
                      {renaming ? (
                        <div className="sidebar-chat-rename" data-testid={`sidebar-chat-${s.id}`}>
                          <IconMessage />
                          <input
                            className="sidebar-chat-rename-input"
                            data-testid={`sidebar-chat-rename-${s.id}`}
                            aria-label={t('chat.renameSession')}
                            value={renameDraft}
                            autoFocus
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelRename();
                              }
                            }}
                            onBlur={() => commitRename()}
                          />
                        </div>
                      ) : (
                        <NavItem
                          href="/"
                          data-testid={`sidebar-chat-${s.id}`}
                          active={sessionId === s.id && pathname === '/'}
                          title={title}
                          onClick={(e) => {
                            e.preventDefault();
                            void useChatStore.getState().loadSession(s.id);
                            void navigate('/');
                          }}
                        >
                          <IconMessage />
                          <span
                            className="jui-navitem__label sidebar-label"
                            data-testid={`sidebar-chat-title-${s.id}`}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              startRename();
                            }}
                          >
                            {title}
                          </span>
                        </NavItem>
                      )}
                      <button
                        type="button"
                        className={`sidebar-pin-btn${pinned ? ' sidebar-pin-btn--on' : ''}`}
                        data-testid={`sidebar-chat-pin-${s.id}`}
                        aria-label={pinned ? t('shell.unpin') : t('shell.pin')}
                        aria-pressed={pinned}
                        title={pinned ? t('shell.unpin') : t('shell.pin')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleChatPin(s.id);
                        }}
                      >
                        <IconPin />
                      </button>
                      <button
                        type="button"
                        className="sidebar-chat-delete"
                        data-testid={`sidebar-chat-delete-${s.id}`}
                        aria-label={t('chat.deleteSession')}
                        title={t('chat.deleteSession')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPendingDelete({ id: s.id, title });
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  );
                })}
              </NavGroup>

              <NavGroup label={t('shell.groupMore')}>
                {item('/agents', 'nav-agents', t('menu.agents'), pathname.startsWith('/agents'), <IconUsers />)}
                {item('/board', 'nav-board', t('board.title'), pathname.startsWith('/board'), <IconBoard />)}
                {item('/coding', 'nav-coding', t('menu.coding'), pathname.startsWith('/coding'), <IconCode />)}
                {item('/office', 'nav-office', t('menu.office'), pathname.startsWith('/office'), <IconFile />)}
                {item('/squad', 'nav-squad', t('menu.squad'), pathname.startsWith('/squad'), <IconUsers />)}
                {item('/workflow', 'nav-workflow', t('workflow.title'), pathname.startsWith('/workflow'), <IconWorkflow />)}
                {item('/canvas', 'nav-canvas', t('canvas.title'), pathname.startsWith('/canvas'), <IconCanvas />)}
              </NavGroup>
                </>
              )}
            </Sidebar>
              <div
                className="sidebar-resize-handle"
                data-testid="sidebar-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label={t('shell.resizeSidebar')}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
              />
              </>
            )}
          </div>
        }
        topBar={(
          <TopBar
            left={inSettings
              ? <span className="settings-topbar-title" data-testid="settings-topbar-title">{t('settings.title')}</span>
              : <AgentSwitcher />}
            right={inSettings ? null : (
              <div className="topbar-actions">
                <ModeIndicator mode={runtimeMode} />
                <TaskControlBar />
              </div>
            )}
          />
        )}
        mainFooter={(
          <div className="shell-repo-footer" data-testid="shell-repo-link">
            <span className="shell-repo-footer__part">
              {t('shell.issuesLabel')}：
              <a
                className="shell-repo-link"
                data-testid="shell-issues-url"
                href={GITHUB_ISSUES_URL}
                target="_blank"
                rel="noreferrer"
                aria-label={t('shell.issuesLinkAria')}
              >
                {GITHUB_ISSUES_URL}
              </a>
            </span>
            <span className="shell-repo-footer__sep" aria-hidden>|</span>
            <span className="shell-repo-footer__part">
              {t('shell.wikiLabel')}：
              <a
                className="shell-repo-link"
                data-testid="shell-wiki-url"
                href={GITHUB_WIKI_URL}
                target="_blank"
                rel="noreferrer"
                aria-label={t('shell.wikiLinkAria')}
              >
                {GITHUB_WIKI_URL}
              </a>
            </span>
          </div>
        )}
      >
        <Outlet />
      </AppShell>
      <ShellSearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        agents={sortedAgents}
        sessions={sortedSessions}
        onSelectAgent={(id) => {
          const agent = agents.find((a) => a.id === id);
          if (agent) setCurrent(agent);
          void navigate('/');
        }}
        onSelectChat={(id) => {
          void useChatStore.getState().loadSession(id);
          void navigate('/');
        }}
        onSelectAction={(id) => {
          switch (id) {
            case 'new-chat':
              void useChatStore.getState().newSession().then(() => {
                void loadSessions();
                void navigate('/');
              });
              break;
            case 'settings':
              void navigate('/settings/providers');
              break;
            case 'agents':
              void navigate('/agents');
              break;
            case 'board':
              void navigate('/board');
              break;
            case 'coding':
              void navigate('/coding');
              break;
            case 'office':
              void navigate('/office');
              break;
            case 'squad':
              void navigate('/squad');
              break;
            case 'workflow':
              void navigate('/workflow');
              break;
            case 'canvas':
              void navigate('/canvas');
              break;
            default:
              break;
          }
        }}
      />
      <Modal
        open={pendingDelete != null}
        testId="chat-delete-confirm"
        title={t('chat.deleteSessionTitle')}
        closeLabel={t('common.close')}
        onClose={() => setPendingDelete(null)}
        actions={(
          <>
            <Button
              variant="ghost"
              data-testid="chat-delete-cancel"
              onClick={() => setPendingDelete(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="chat-delete-confirm-btn"
              onClick={() => {
                const id = pendingDelete?.id;
                setPendingDelete(null);
                if (id) void useChatStore.getState().deleteSession(id);
              }}
            >
              {t('chat.deleteSessionAction')}
            </Button>
          </>
        )}
      >
        <p>{t('chat.deleteSessionConfirm')}</p>
        {pendingDelete ? <p className="sidebar-chat-delete-name">{pendingDelete.title}</p> : null}
      </Modal>
    </div>
  );
}
