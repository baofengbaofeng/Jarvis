import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig } from '@jarvis/protocol';
import { TimelineView } from '../components/squad/TimelineView';
import { CallGraphView } from '../components/squad/CallGraphView';
import { ApprovalPanel } from '../components/squad/ApprovalPanel';

// M6 Task 10 (K5/L14): the squad view drives the ApprovalPanel with FULL data
// (summary/members) via squad.current — the Task 8 gap where squad:status only
// carried { id, state }. The page polls squad.current every 3s so a squad run
// that reaches in_review from a background start surfaces the panel without a
// reload. Invokes are wrapped in try/catch (Task 1 convention) so a bridge
// failure shows an inline error instead of an unhandled rejection.
//
// M6 final review (finding 5): the S5 scenario was not launchable — no renderer
// invoked squad.create/squad.start. This page now carries a minimal "New squad"
// launch control: a leader select, member checkboxes and a task input that call
// the existing squad.create/squad.start IPC, so the whole flow (leader routes to
// members -> in_review -> approve/reject) is runnable from the product.
interface SquadState { id: string; leaderAgentId: string; memberAgentIds: string[]; status: string; summary?: string; members?: Array<{ agent: string; result: string }>; graphRows?: Array<{ from: string; to: string; label: string }> }

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
    // A member cannot be the leader; drop it from the member set.
    setMemberIds(ids => ids.filter(x => x !== id));
  };

  // S5 launch control: squad.create -> squad.start. Both channels already exist
  // in main (./squad IPC); this is the missing renderer surface that invokes
  // them with the selected leader/members/task.
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

  // Empty state still surfaces a load error (a failed squad.current invoke
  // leaves squad null, so the full view below would hide it otherwise).
  if (!squad) {
    return (
      <div data-testid="squad-view">
        {error ? <p data-testid="squad-view-error" role="alert">{error}</p> : null}
        <button data-testid="squad-new" onClick={() => setShowCreate(v => !v)}>{t('squadView.newSquad')}</button>
        {showCreate ? (
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
        ) : null}
      </div>
    );
  }
  return (
    <div data-testid="squad-view">
      <h2>{t('squadView.title', { id: squad.id, status: squad.status })}</h2>
      <div>{t('squadView.leader')}: {squad.leaderAgentId} / {t('squadView.members')}: {squad.memberAgentIds.join(', ')}</div>
      {error ? <p data-testid="squad-view-error" role="alert">{error}</p> : null}
      <button data-testid="squad-new" onClick={() => setShowCreate(v => !v)}>{t('squadView.newSquad')}</button>
      {showCreate ? (
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
      ) : null}
      <CallGraphView rows={squad.graphRows ?? []} />
      <TimelineView />
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
    <div data-testid="squad-create-form">
      <div>
        <label>{t('squadView.leader')}</label>
        <select data-testid="squad-leader-select" value={leaderId} onChange={e => onLeaderChange(e.target.value)}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label>{t('squadView.members')}</label>
        {agents.filter(a => a.id !== leaderId).map(a => (
          <label key={a.id}>
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
      <div>
        <label>{t('squadView.task')}</label>
        <input data-testid="squad-task-input" value={task} onChange={e => onTaskChange(e.target.value)} />
      </div>
      <button data-testid="squad-create-submit" onClick={onCreate}>{t('squadView.create')}</button>
      <button onClick={onCancel}>{t('common.cancel')}</button>
      {createError ? <p data-testid="squad-create-error" role="alert">{createError}</p> : null}
    </div>
  );
}
