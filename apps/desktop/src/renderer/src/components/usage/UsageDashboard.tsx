import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, EmptyState, PageHeader, StatCard } from '@jarvis/ui';
import { useUsageStore } from '../../stores/usage-store';

export function UsageDashboard() {
  const { t } = useTranslation('common');
  const summary = useUsageStore((s) => s.summary);
  const load = useUsageStore((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  if (!summary) return <div data-testid="usage-loading">…</div>;
  return (
    <div data-testid="usage-dashboard" className="page usage-dashboard settings-page">
      <PageHeader title={t('usage.title')} subtitle={t('usage.subtitle')} />
      <div className="usage-dashboard__stats">
        <StatCard
          label={t('usage.totalTokens')}
          value={<span data-testid="usage-total-tokens">{summary.total.totalTokens}</span>}
        />
        <StatCard label={t('usage.col.calls')} value={summary.total.calls} />
      </div>
      {summary.byAgent.length === 0 ? (
        <EmptyState title={t('usage.empty')} />
      ) : (
        <DataTable
          columns={[
            { key: 'agentId', header: t('usage.col.agent') },
            { key: 'promptTokens', header: t('usage.col.prompt'), render: (row) => row.usage.promptTokens },
            { key: 'completionTokens', header: t('usage.col.completion'), render: (row) => row.usage.completionTokens },
            { key: 'totalTokens', header: t('usage.col.total'), render: (row) => row.usage.totalTokens },
            { key: 'calls', header: t('usage.col.calls'), render: (row) => row.usage.calls },
          ]}
          rows={summary.byAgent}
          rowKey={(row) => row.agentId}
        />
      )}
    </div>
  );
}
