import { useTranslation } from 'react-i18next';
import { Badge } from '@jarvis/ui';

export function PlanModeBadge({ active }: { active: boolean }) {
  const { t } = useTranslation('common');
  if (!active) return null;
  return <Badge variant="plan" data-testid="plan-badge">{t('plan.badge')}</Badge>;
}
