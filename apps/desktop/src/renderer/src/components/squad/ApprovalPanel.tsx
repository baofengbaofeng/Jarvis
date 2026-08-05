import { useTranslation } from 'react-i18next';

// F15 (M6 Task 8): the squad-level human approval panel, shown while a squad is
// in_review. Plain props (imports nothing from @jarvis/core at runtime) so the
// component stays a dumb presentational surface; the squad-store drives it from
// the app root. Approve/Reject route through squad.approve (approved → completed,
// rejected → back to in_progress) and then call onDone so the store clears.
export function ApprovalPanel({ squadId, summary, members, onDone }: {
  squadId: string; summary: string; members: Array<{ agent: string; result: string }>;
  onDone: () => void;
}) {
  const { t } = useTranslation('common');
  const decide = async (ok: boolean) => {
    try {
      await window.jarvis.invoke('squad.approve', squadId, ok);
    } catch {
      // Task 1 convention: an IPC rejection must not reject the click handler.
      // The squad:status event clears the panel when the outcome lands; on a
      // failure the panel simply stays open.
    }
    onDone();
  };
  return (
    <div data-testid="approval-panel">
      <h3>{t('approval.title')}</h3>
      <p data-testid="approval-summary" aria-label={t('approval.summary')}>{summary}</p>
      <ul>{members.map(m => <li key={m.agent} data-testid={`approval-member-${m.agent}`}>{m.agent}: {m.result}</li>)}</ul>
      <button data-testid="approval-ok" onClick={() => void decide(true)}>{t('approval.approve')}</button>
      <button data-testid="approval-no" onClick={() => void decide(false)}>{t('approval.reject')}</button>
    </div>
  );
}
