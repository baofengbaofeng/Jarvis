import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// F15 (M6 Task 8): the squad-level human approval panel, shown while a squad is
// in_review. Plain props (imports nothing from @jarvis/core at runtime) so the
// component stays a dumb presentational surface; the squad-store drives it from
// the app root. Approve/Reject route through squad.approve (single { id, ok }
// object — the main handler destructures it; the preload spreads positional
// args, so a two-arg call would leave id/ok undefined). approved → completed,
// rejected → back to in_progress; onDone fires only on a successful decision so
// a failed invoke keeps the panel open (Task 1 convention: { ok, error }).
export function ApprovalPanel({ squadId, summary, members, onDone }: {
  squadId: string; summary: string; members: Array<{ agent: string; result: string }>;
  onDone: () => void;
}) {
  const { t } = useTranslation('common');
  const [error, setError] = useState<string | null>(null);
  const decide = async (ok: boolean) => {
    try {
      const res = (await window.jarvis.invoke('squad.approve', { id: squadId, ok })) as { ok: boolean; error?: string };
      if (!res.ok) {
        // Keep the panel open and surface the rejection inline so the user can
        // retry; the squad is still in_review.
        setError(res.error ?? 'approval failed');
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setError(null);
    onDone();
  };
  return (
    <div data-testid="approval-panel">
      <h3>{t('approval.title')}</h3>
      {/* Event-driven in_review arrivals have no summary/members yet (the
          squad:status event carries only { id, state }); omit them so the panel
          renders a clean "pending approval" state instead of a raw squad UUID. */}
      {summary ? <p data-testid="approval-summary" aria-label={t('approval.summary')}>{summary}</p> : null}
      {members.length > 0 ? <ul>{members.map(m => <li key={m.agent} data-testid={`approval-member-${m.agent}`}>{m.agent}: {m.result}</li>)}</ul> : null}
      {error ? <p data-testid="approval-error" role="alert">{error}</p> : null}
      <button data-testid="approval-ok" onClick={() => void decide(true)}>{t('approval.approve')}</button>
      <button data-testid="approval-no" onClick={() => void decide(false)}>{t('approval.reject')}</button>
    </div>
  );
}
