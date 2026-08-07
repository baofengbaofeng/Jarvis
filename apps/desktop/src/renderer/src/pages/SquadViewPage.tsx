import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, PageHeader, Panel, Select, StatusBadge } from '@jarvis/ui';
import type { AgentConfig } from '@jarvis/protocol';
import { TimelineView } from '../components/squad/TimelineView';
import { CallGraphView } from '../components/squad/CallGraphView';
import { ApprovalPanel } from '../components/squad/ApprovalPanel';

interface SquadState { id: string; leaderAgentId: string; memberAgentIds: string[]; status: string; summary?: string; members?: Array<{ agent: string; result: string }>; graphRows?: Array<{ from: string; to: string; label: string }> }

const SQUAD_STATUS: Record<string, 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'warning' | 'default'> = {
  queued: 'queued',
  running: 'running',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  in_review: 'warning',
};

export function SquadViewPage() {
  const { t } = useTranslation('common');
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [leaderId, setLeaderId] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [task, setTask] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = (await window.jarvis.invoke('squad.current')) as { ok: boolean; squad?: SquadState | null; error?: string };
      if (!res.ok) { setError(res.error ?? 'failed to load squad'); return; }
      setSquad(res.squad ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadAgents = async () => {
    try {
      const list = (await window.jarvis.invoke('agent.list')) as AgentConfig[] | null;
      const resolved = Array.isArray(list) ? list : [];
      setAgents(resolved);
      setLeaderId(prev => prev || (resolved[0]?.id ?? ''));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void refresh(); void loadAgents(); const iv = setInterval(() => void refresh(), 3000); return () => clearInterval(iv); }, []);

  const toggleMember = (id: string) => setMemberIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const changeLeader = (id: string) => {
    setLeaderId(id);
    setMemberIds(ids => ids.filter(x => x !== id));
  };

  const handleCreate = async () => {
    setCreateError(null);
    try {
      const res = (await window.jarvis.invoke('squad.create', { leaderAgentId: leaderId, memberAgentIds: memberIds })) as { ok: boolean; id: string; error?: string };
      if (!res.ok) { setCreateError(res.error ?? 'failed to create squad'); return; }
      const startRes = (await window.jarvis.invoke('squad.start', { id: res.id, input: task })) as { ok: boolean; error?: string };
      if (!startRes.ok) { setCreateError(startRes.error ?? 'failed to start squad'); return; }
      setShowCreate(false);
      setTask('');
      setError(null);
      await refresh();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  const createForm = showCreate ? (
    <SquadCreateForm
      agents={agents}
      leaderId={leaderId}
      memberIds={memberIds}
      task={task}
      createError={createError}
      onLeaderChange={changeLeader}
      onToggleMember={toggleMember}
      onTaskChange={setTask}
      onCreate={() => void handleCreate()}
      onCancel={() => setShowCreate(false)}
    />
  ) : null;

  if (!squad) {
    return (
      <div data-testid="squad-view" className="squad-page page">
        <PageHeader
          title={t('menu.squad')}
          actions={<Button variant="primary" data-testid="squad-new" onClick={() => setShowCreate(v => !v)}>{t('squadView.newSquad')}</Button>}
        />
        {error ? <p data-testid="squad-view-error" className="error-text" role="alert">{error}</p> : null}
        {createForm}
      </div>
    );
  }
  return (
    <div data-testid="squad-view" className="squad-page page">
      <PageHeader
        title={t('squadView.title', { id: squad.id, status: squad.status })}
        subtitle={`${t('squadView.leader')}: ${squad.leaderAgentId} / ${t('squadView.members')}: ${squad.memberAgentIds.join(', ')}`}
        badges={<StatusBadge status={SQUAD_STATUS[squad.status] ?? 'default'}>{squad.status}</StatusBadge>}
        actions={<Button variant="ghost" data-testid="squad-new" onClick={() => setShowCreate(v => !v)}>{t('squadView.newSquad')}</Button>}
      />
      {error ? <p data-testid="squad-view-error" className="error-text" role="alert">{error}</p> : null}
      {createForm}
      <div className="squad-page__grid">
        <Panel className="squad-page__panel"><CallGraphView rows={squad.graphRows ?? []} /></Panel>
        <Panel className="squad-page__panel"><TimelineView /></Panel>
      </div>
      {squad.status === 'in_review' && squad.summary != null && squad.members != null && (
        <ApprovalPanel squadId={squad.id} summary={squad.summary} members={squad.members} onDone={() => void refresh()} />
      )}
    </div>
  );
}

function SquadCreateForm(props: {
  agents: AgentConfig[];
  leaderId: string;
  memberIds: string[];
  task: string;
  createError: string | null;
  onLeaderChange: (id: string) => void;
  onToggleMember: (id: string) => void;
  onTaskChange: (t: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('common');
  const { agents, leaderId, memberIds, task, createError, onLeaderChange, onToggleMember, onTaskChange, onCreate, onCancel } = props;
  return (
    <Panel data-testid="squad-create-form" className="form-stack">
      <div className="form-field">
        <label htmlFor="squad-leader">{t('squadView.leader')}</label>
        <Select id="squad-leader" data-testid="squad-leader-select" value={leaderId} onChange={e => onLeaderChange(e.target.value)}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <div className="checkbox-group">
        <span className="settings-card__meta">{t('squadView.members')}</span>
        {agents.filter(a => a.id !== leaderId).map(a => (
          <label key={a.id} className="checkbox-label">
            <input
              type="checkbox"
              data-testid={`squad-member-${a.id}`}
              checked={memberIds.includes(a.id)}
              onChange={() => onToggleMember(a.id)}
            />
            {a.name}
          </label>
        ))}
      </div>
      <div className="form-field">
        <label htmlFor="squad-task">{t('squadView.task')}</label>
        <Input id="squad-task" data-testid="squad-task-input" value={task} onChange={e => onTaskChange(e.target.value)} />
      </div>
      <div className="page__actions">
        <Button variant="primary" data-testid="squad-create-submit" onClick={onCreate}>{t('squadView.create')}</Button>
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
      {createError ? <p data-testid="squad-create-error" className="error-text" role="alert">{createError}</p> : null}
    </Panel>
  );
}
