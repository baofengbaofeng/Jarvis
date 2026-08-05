import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TimelineView } from '../components/squad/TimelineView';
import { CallGraphView } from '../components/squad/CallGraphView';
import { ApprovalPanel } from '../components/squad/ApprovalPanel';

// M6 Task 10 (K5/L14): the squad view drives the ApprovalPanel with FULL data
// (summary/members) via squad.current — the Task 8 gap where squad:status only
// carried { id, state }. The page polls squad.current every 3s so a squad run
// that reaches in_review from a background start surfaces the panel without a
// reload. Invokes are wrapped in try/catch (Task 1 convention) so a bridge
// failure shows an inline error instead of an unhandled rejection.
interface SquadState { id: string; leaderAgentId: string; memberAgentIds: string[]; status: string; summary?: string; members?: Array<{ agent: string; result: string }>; graphRows?: Array<{ from: string; to: string; label: string }> }

export function SquadViewPage() {
  const { t } = useTranslation('common');
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  useEffect(() => { void refresh(); const iv = setInterval(() => void refresh(), 3000); return () => clearInterval(iv); }, []);
  // Empty state still surfaces a load error (a failed squad.current invoke
  // leaves squad null, so the full view below would hide it otherwise).
  if (!squad) return <div data-testid="squad-view">{error ? <p data-testid="squad-view-error" role="alert">{error}</p> : null}</div>;
  return (
    <div data-testid="squad-view">
      <h2>{t('squadView.title', { id: squad.id, status: squad.status })}</h2>
      <div>{t('squadView.leader')}: {squad.leaderAgentId} / {t('squadView.members')}: {squad.memberAgentIds.join(', ')}</div>
      {error ? <p data-testid="squad-view-error" role="alert">{error}</p> : null}
      <CallGraphView rows={squad.graphRows ?? []} />
      <TimelineView />
      {squad.status === 'in_review' && squad.summary != null && squad.members != null && (
        <ApprovalPanel squadId={squad.id} summary={squad.summary} members={squad.members} onDone={() => void refresh()} />
      )}
    </div>
  );
}
