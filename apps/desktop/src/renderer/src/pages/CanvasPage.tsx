import { useTranslation } from 'react-i18next';
import { CanvasView } from '../components/canvas/CanvasView';

export function CanvasPage() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="canvas-page" className="page page--wide">
      <div className="page__header">
        <h1 className="page__title">{t('canvas.title')}</h1>
      </div>
      <div className="office-page__content">
        <CanvasView />
      </div>
    </div>
  );
}
