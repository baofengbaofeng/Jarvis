import { useTranslation } from 'react-i18next';

export type RuntimeMode = 'local' | 'runtime_registered' | 'runtime_busy';

const DOT: Record<RuntimeMode, string> = {
  local: 'bg-slate-400',
  runtime_registered: 'bg-green-500',
  runtime_busy: 'bg-amber-500',
};

export function ModeIndicator({ mode }: { mode: RuntimeMode }) {
  const { t } = useTranslation('common');
  return (
    <span data-testid="mode-indicator" className="inline-flex items-center gap-1.5 text-xs">
      <span data-testid="mode-dot" className={`h-2 w-2 rounded-full ${DOT[mode]}`} />
      {t(`runtime.mode.${mode}`)}
    </span>
  );
}
