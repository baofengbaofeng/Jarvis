import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRuntimeStore } from '../../stores/runtime-store';
import { ModeIndicator, type RuntimeMode } from './ModeIndicator';

export function RuntimeStatusView() {
  const { t } = useTranslation('common');
  const status = useRuntimeStore((s) => s.status);
  const refresh = useRuntimeStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
  }, [refresh]);
  if (!status) return <div data-testid="runtime-status" />;
  const mode: RuntimeMode = status.mode;
  return (
    <div data-testid="runtime-status" className="runtime-status">
      <ModeIndicator mode={mode} />
      <p data-testid="runtime-registered">
        {t('runtime.registered', { v: status.registered ? t('runtime.registeredYes') : t('runtime.registeredNo') })}
      </p>
      <p>{t('runtime.protocol')}: {status.protocol}</p>
      <p>{t('runtime.server')}: {status.serverUrl || '-'}</p>
      <p>{t('runtime.heartbeat')}: {status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt * 1000).toLocaleTimeString() : '-'}</p>
      <p>{t('runtime.activeTasks')}: {status.activeTasks}</p>
    </div>
  );
}
