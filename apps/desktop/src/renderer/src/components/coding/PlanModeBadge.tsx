import { useTranslation } from 'react-i18next';

export function PlanModeBadge({ active }: { active: boolean }) {
  const { t } = useTranslation('common');
  if (!active) return null;
  return <span data-testid="plan-badge" className="badge badge--plan">{t('plan.badge')}</span>;
}
