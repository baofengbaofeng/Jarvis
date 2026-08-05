import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface VersionRow { id: string; createdAt: string; fields: string[] }

// M6 Task 9 (L31): agent config version history + one-click rollback. Lists the
// snapshots the main version store records before every agent.update; clicking
// 回滚 restores the selected snapshot through agents.rollback. Both channels
// take a SINGLE object payload — the preload spreads positional args, so the
// object shape is the contract (a two-arg invoke('agents.rollback', id,
// versionId) call would leave the handler's destructure undefined and silently
// no-op). Handlers return { ok, ... } / { ok, error }; invokes are wrapped in
// try/catch (Task 1 convention) and a failed rollback keeps the list intact.
export function VersionHistoryPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation('common');
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [diff, setDiff] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try {
      const res = (await window.jarvis.invoke('agents.versions', { id: agentId })) as { ok: boolean; versions?: VersionRow[]; error?: string };
      if (!res.ok) {
        setError(res.error ?? 'failed to load versions');
        return;
      }
      setVersions(res.versions ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { void refresh(); }, [agentId]);
  const rollback = async (versionId: string) => {
    try {
      const res = (await window.jarvis.invoke('agents.rollback', { id: agentId, versionId })) as { ok: boolean; error?: string };
      if (!res.ok) {
        // Keep the list and surface the failure so the user can retry.
        setError(res.error ?? 'rollback failed');
        return;
      }
      setDiff(t('versionHistory.rolledBack'));
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div data-testid="version-history">
      <h3>{t('versionHistory.title')}</h3>
      {error ? <p data-testid="version-error" role="alert">{error}</p> : null}
      <ul>
        {versions.map(v => (
          <li key={v.id}>
            {v.createdAt} — {t('versionHistory.fields')}: {v.fields.join(', ')}
            <button data-testid={`rollback-${v.id}`} onClick={() => void rollback(v.id)}>{t('versionHistory.rollback')}</button>
          </li>
        ))}
      </ul>
      <pre data-testid="version-diff">{diff}</pre>
    </div>
  );
}
