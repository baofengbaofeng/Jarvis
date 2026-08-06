import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageStore } from '../../stores/usage-store';

export function UsageDashboard() {
  const { t } = useTranslation('common');
  const summary = useUsageStore((s) => s.summary);
  const load = useUsageStore((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  if (!summary) return <div data-testid="usage-loading">…</div>;
  return (
    <div data-testid="usage-dashboard" className="usage-dashboard">
      <h2 className="usage-dashboard__title">{t('usage.title')}</h2>
      <div className="usage-dashboard__total">
        <span data-testid="usage-total-tokens">{summary.total.totalTokens}</span> {t('usage.totalTokens')} / {summary.total.calls} {t('usage.col.calls')}
      </div>
      <table className="usage-dashboard__table">
        <thead>
          <tr>
            <th>{t('usage.col.agent')}</th>
            <th>{t('usage.col.prompt')}</th>
            <th>{t('usage.col.completion')}</th>
            <th>{t('usage.col.total')}</th>
            <th>{t('usage.col.calls')}</th>
          </tr>
        </thead>
        <tbody>
          {summary.byAgent.map((row) => (
            <tr key={row.agentId}>
              <td>{row.agentId}</td>
              <td>{row.usage.promptTokens}</td>
              <td>{row.usage.completionTokens}</td>
              <td>{row.usage.totalTokens}</td>
              <td>{row.usage.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
