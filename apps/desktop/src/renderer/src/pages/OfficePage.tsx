import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabPanel, Textarea } from '@jarvis/ui';
import { WritingView } from '../components/office/WritingView';
import { VoiceInputButton } from '../components/office/VoiceInputButton';
import { DropZone } from '../components/office/DropZone';
import { SearchProvidersPage } from '../components/office/SearchProvidersPage';
import { WebViewSummary } from '../components/office/WebViewSummary';
import { VideoSummary } from '../components/office/VideoSummary';
import { ImageGenerator } from '../components/office/ImageGenerator';
import { GlobalSearch } from '../components/office/GlobalSearch';
import { PromptTemplatesPage } from './PromptTemplatesPage';
import { classifyFile } from '@jarvis/core/renderer';

const PdfReaderPage = lazy(() => import('./PdfReaderPage').then(m => ({ default: m.PdfReaderPage })));

type OfficeTab = 'writing' | 'pdf' | 'composer' | 'templates' | 'search' | 'web' | 'video' | 'image' | 'globalsearch';
const OFFICE_TABS: OfficeTab[] = ['writing', 'pdf', 'composer', 'templates', 'search', 'web', 'video', 'image', 'globalsearch'];

export function OfficePage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<OfficeTab>('writing');
  const [composer, setComposer] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<Array<{ name: string; status: 'ok' | 'error'; text: string }>>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const handleAttach = async (files: Array<{ token: string; name: string }>) => {
    setAttached(files.map(f => f.name));
    for (const f of files) {
      if (classifyFile(f.name) === 'image') continue;
      try {
        const r = (await window.jarvis.invoke('office.file.analyze', { capability: f.token, name: f.name })) as { ok: boolean; result?: string; error?: string };
        setAnalysis(prev => [...prev, { name: f.name, status: r.ok ? 'ok' : 'error', text: r.ok ? (r.result ?? '') : (r.error ?? t('officeTools.error')) }]);
      } catch (e) {
        setAnalysis(prev => [...prev, { name: f.name, status: 'error', text: e instanceof Error ? e.message : String(e) }]);
      }
    }
  };

  const insertToComposer = (text: string) => {
    const el = composerRef.current;
    if (el && document.activeElement === el) {
      const { selectionStart, selectionEnd } = el;
      setComposer(composer.slice(0, selectionStart) + text + composer.slice(selectionEnd));
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = selectionStart + text.length;
        });
      }
    } else {
      setComposer(prev => prev ? `${prev}\n${text}` : text);
    }
  };

  return (
    <div data-testid="office-page" className="office-page page page--wide">
      <div className="page__header office-page__header">
        <h1 className="page__title">{t('office.title')}</h1>
      </div>
      <Tabs
        tabs={OFFICE_TABS.map(tb => ({ id: tb, label: t(`office.tabs.${tb}`), testId: `office-tab-${tb}` }))}
        active={tab}
        onChange={(id) => setTab(id as OfficeTab)}
      />

      <div className="office-page__content">
        <TabPanel active={tab === 'writing'}>
          <DropZone onAttach={(files) => void handleAttach(files)} onCopied={(names) => setAttached(prev => [...prev, ...names])}>
            <WritingView />
          </DropZone>
        </TabPanel>

        {attached.length > 0 && <div data-testid="office-attached">📎 {attached.join(', ')}</div>}
        {analysis.length > 0 && (
          <div data-testid="office-analysis" className="office-analysis">
            <h3 className="office-analysis__title">{t('officeTools.analysis')}</h3>
            {analysis.map((a, i) => (
              <div key={`${a.name}-${i}`} data-testid={`office-analysis-${i}`} className="office-analysis__item">
                <strong>{a.name}</strong> — {a.status === 'ok' ? a.text : `${t('officeTools.error')}: ${a.text}`}
              </div>
            ))}
          </div>
        )}

        <TabPanel active={tab === 'pdf'}>
          <Suspense fallback={null}><PdfReaderPage /></Suspense>
        </TabPanel>

        <TabPanel active={tab === 'composer'}>
          <VoiceInputButton onText={insertToComposer} />
          <Textarea
            ref={composerRef}
            data-testid="office-composer"
            value={composer}
            onChange={e => setComposer(e.target.value)}
            rows={8}
            className="office-composer"
          />
        </TabPanel>

        <TabPanel active={tab === 'templates'}>
          <PromptTemplatesPage onInsert={insertToComposer} />
        </TabPanel>

        <TabPanel active={tab === 'search'}>
          <SearchProvidersPage />
        </TabPanel>

        <TabPanel active={tab === 'web'}>
          <WebViewSummary />
        </TabPanel>

        <TabPanel active={tab === 'video'}>
          <VideoSummary />
        </TabPanel>

        <TabPanel active={tab === 'image'}>
          <ImageGenerator />
        </TabPanel>

        <TabPanel active={tab === 'globalsearch'}>
          <GlobalSearch />
        </TabPanel>
      </div>
    </div>
  );
}
