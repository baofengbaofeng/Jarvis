import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Panel } from '@jarvis/ui';

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
    <Panel elevated data-testid="approval-panel" className="form-stack">
      <h3 className="page__title">{t('approval.title')}</h3>
      {summary ? <p data-testid="approval-summary" aria-label={t('approval.summary')}>{summary}</p> : null}
      {members.length > 0 ? (
        <ul className="settings-card-list">
          {members.map(m => (
            <li key={m.agent} data-testid={`approval-member-${m.agent}`} className="settings-card__meta">{m.agent}: {m.result}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p data-testid="approval-error" className="error-text" role="alert">{error}</p> : null}
      <div className="page__actions">
        <Button variant="primary" data-testid="approval-ok" onClick={() => void decide(true)}>{t('approval.approve')}</Button>
        <Button variant="danger" data-testid="approval-no" onClick={() => void decide(false)}>{t('approval.reject')}</Button>
      </div>
    </Panel>
  );
}
