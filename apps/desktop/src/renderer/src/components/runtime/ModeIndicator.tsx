import { useTranslation } from 'react-i18next';

export type RuntimeMode = 'local' | 'runtime_registered' | 'runtime_busy';

const DOT: Record<RuntimeMode, string> = {
  local: 'mode-dot--idle',
  runtime_registered: 'mode-dot--running',
  runtime_busy: 'mode-dot--paused',
};

export function ModeIndicator({ mode }: { mode: RuntimeMode }) {
  const { t } = useTranslation('common');
  return (
    <span data-testid="mode-indicator" className="mode-indicator">
      <span data-testid="mode-dot" className={`mode-dot ${DOT[mode]}`} />
      {t(`runtime.mode.${mode}`)}
    </span>
  );
}
