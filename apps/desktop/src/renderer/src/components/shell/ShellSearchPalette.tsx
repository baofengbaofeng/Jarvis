import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconBoard,
  IconBot,
  IconCanvas,
  IconCode,
  IconFile,
  IconMessage,
  IconMessagePlus,
  IconSearch,
  IconSettings,
  IconUsers,
  IconWorkflow,
} from './ShellIcons';

export type SearchTab = 'all' | 'agents' | 'chats' | 'actions';

export type ShellSearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  agents: Array<{ id: string; name: string; slug: string }>;
  sessions: Array<{ id: string; title: string }>;
  onSelectAgent: (id: string) => void;
  onSelectChat: (id: string) => void;
  onSelectAction: (id: string) => void;
};

type PaletteItem = {
  id: string;
  kind: 'agent' | 'chat' | 'action';
  title: string;
  subtitle?: string;
  icon: ReactNode;
};

const ACTION_IDS = [
  'new-chat',
  'settings',
  'agents',
  'board',
  'coding',
  'office',
  'squad',
  'workflow',
  'canvas',
] as const;

/** Empty-query preview cap; typed search still matches the full lists. */
export const PALETTE_LIST_LIMIT = 5;

export function ShellSearchPalette({
  open,
  onClose,
  agents,
  sessions,
  onSelectAgent,
  onSelectChat,
  onSelectAction,
}: ShellSearchPaletteProps) {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('all');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTab('all');
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const actionItems = useMemo<PaletteItem[]>(() => {
    const icon = (id: (typeof ACTION_IDS)[number]): ReactNode => {
      switch (id) {
        case 'new-chat': return <IconMessagePlus />;
        case 'settings': return <IconSettings />;
        case 'agents': return <IconUsers />;
        case 'board': return <IconBoard />;
        case 'coding': return <IconCode />;
        case 'office': return <IconFile />;
        case 'squad': return <IconUsers />;
        case 'workflow': return <IconWorkflow />;
        case 'canvas': return <IconCanvas />;
      }
    };
    return ACTION_IDS.map((id) => ({
      id,
      kind: 'action' as const,
      title: t(`shell.palette.action.${id}`),
      icon: icon(id),
    }));
  }, [t]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searching = q.length > 0;
    const match = (text: string) => !searching || text.toLowerCase().includes(q);

    let agentItems: PaletteItem[] = agents
      .filter((a) => match(a.name) || match(a.slug) || match(a.id))
      .map((a) => ({
        id: a.id,
        kind: 'agent' as const,
        title: a.name,
        subtitle: a.slug,
        icon: <IconBot />,
      }));

    let chatItems: PaletteItem[] = sessions
      .filter((s) => match(s.title || '') || match(s.id))
      .map((s) => ({
        id: s.id,
        kind: 'chat' as const,
        title: s.title || s.id,
        icon: <IconMessage />,
      }));

    // Preview lists are capped; active search still filters the full collections.
    if (!searching) {
      agentItems = agentItems.slice(0, PALETTE_LIST_LIMIT);
      chatItems = chatItems.slice(0, PALETTE_LIST_LIMIT);
    }

    const actions = actionItems.filter((a) => match(a.title));

    if (tab === 'agents') return agentItems;
    if (tab === 'chats') return chatItems;
    if (tab === 'actions') return actions;
    return [...agentItems, ...chatItems, ...actions];
  }, [agents, sessions, actionItems, query, tab]);

  useEffect(() => {
    setActive(0);
  }, [query, tab]);

  const runItem = (item: PaletteItem) => {
    if (item.kind === 'agent') onSelectAgent(item.id);
    else if (item.kind === 'chat') onSelectChat(item.id);
    else onSelectAction(item.id);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (items.length === 0 ? 0 : Math.min(items.length - 1, i + 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        const item = items[active];
        if (!item) return;
        e.preventDefault();
        if (item.kind === 'agent') onSelectAgent(item.id);
        else if (item.kind === 'chat') onSelectChat(item.id);
        else onSelectAction(item.id);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, active, onClose, onSelectAgent, onSelectChat, onSelectAction]);

  if (!open) return null;

  const tabs: SearchTab[] = ['all', 'agents', 'chats', 'actions'];
  const agentsList = items.filter((i) => i.kind === 'agent');
  const chatsList = items.filter((i) => i.kind === 'chat');
  const actionsList = items.filter((i) => i.kind === 'action');

  const renderGroup = (label: string, group: PaletteItem[], offset: number) => {
    if (group.length === 0) return null;
    return (
      <div className="shell-palette__group" key={label}>
        <div className="shell-palette__group-label">{label}</div>
        {group.map((item, idx) => {
          const index = offset + idx;
          return (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              className={`shell-palette__item${index === active ? ' shell-palette__item--active' : ''}`}
              data-testid={`shell-palette-item-${item.kind}-${item.id}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => runItem(item)}
            >
              <span className="shell-palette__item-icon">{item.icon}</span>
              <span className="shell-palette__item-text">
                <span className="shell-palette__item-title">{item.title}</span>
                {item.subtitle ? (
                  <span className="shell-palette__item-sub">{item.subtitle}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="shell-palette-backdrop"
      data-testid="shell-search-palette"
      role="dialog"
      aria-modal="true"
      aria-label={t('shell.search')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="shell-palette">
        <div className="shell-palette__search">
          <IconSearch />
          <input
            ref={inputRef}
            className="shell-palette__input"
            data-testid="shell-palette-input"
            type="search"
            value={query}
            placeholder={t('shell.palette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="shell-palette__tabs" role="tablist">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`shell-palette__tab${tab === id ? ' shell-palette__tab--active' : ''}`}
              data-testid={`shell-palette-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {t(`shell.palette.tab.${id}`)}
            </button>
          ))}
        </div>
        <div className="shell-palette__body" data-testid="shell-palette-results">
          {items.length === 0 ? (
            <div className="shell-palette__empty" data-testid="shell-palette-empty">
              {t('shell.palette.empty')}
            </div>
          ) : tab === 'all' ? (
            <>
              {renderGroup(t('shell.palette.sectionAgents'), agentsList, 0)}
              {renderGroup(t('shell.palette.sectionChats'), chatsList, agentsList.length)}
              {renderGroup(
                t('shell.palette.sectionActions'),
                actionsList,
                agentsList.length + chatsList.length,
              )}
            </>
          ) : (
            renderGroup(
              tab === 'agents'
                ? t('shell.palette.sectionAgents')
                : tab === 'chats'
                  ? t('shell.palette.sectionChats')
                  : t('shell.palette.sectionActions'),
              items,
              0,
            )
          )}
        </div>
        <div className="shell-palette__footer">
          <span>{t('shell.palette.hintSelect')}</span>
          <span>{t('shell.palette.hintOpen')}</span>
          <span>{t('shell.palette.hintEsc')}</span>
        </div>
      </div>
    </div>
  );
}
