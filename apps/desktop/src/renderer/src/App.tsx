import { useTranslation } from 'react-i18next';
import { ThemeProvider } from './components/theme/ThemeProvider';

export default function App() {
  const { t } = useTranslation('common');
  return (
    <ThemeProvider>
      <div data-testid="app-root">
        <h1>{t('app.title')}</h1>
        <p>{t('app.subtitle')}</p>
      </div>
    </ThemeProvider>
  );
}
