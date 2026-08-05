import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WritingView } from '../components/office/WritingView';
import { VoiceInputButton } from '../components/office/VoiceInputButton';
import { DropZone } from '../components/office/DropZone';
import { SearchProvidersPage } from '../components/office/SearchProvidersPage';
import { PromptTemplatesPage } from './PromptTemplatesPage';

// PdfReaderPage is lazy-loaded: pdfjs-dist's browser build references
// browser-only globals (DOMMatrix) at module scope, so pulling it into the
// office page's initial chunk would break render-time on non-DOM runtimes and
// bloat the aggregate bundle. Lazy + Suspense keeps the PDF reader (and its
// worker asset) out until the PDF tab is actually opened.
const PdfReaderPage = lazy(() => import('./PdfReaderPage').then(m => ({ default: m.PdfReaderPage })));

type OfficeTab = 'writing' | 'pdf' | 'composer' | 'templates' | 'search';
const OFFICE_TABS: OfficeTab[] = ['writing', 'pdf', 'composer', 'templates', 'search'];

// M5 aggregate entry: every previously-unmounted office capability gets a
// runnable mount here (D5/D6 writing, D7 pdf, D11 voice, D12/L22 drag-drop,
// D15 templates, L25 search providers). SelectionMenu is deliberately NOT
// remounted — it is a global mouseup overlay already mounted once at the App
// root (Task 1). Voice input and template inserts share a local composer
// textarea (a lightweight "office scratchpad") so both have a real insertion
// target without coupling into WritingView's internal state.
export function OfficePage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<OfficeTab>('writing');
  const [composer, setComposer] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Insert at the composer's cursor when it is focused, else append. Cursor
  // restoration is guarded because jsdom/older runtimes may lack rAF; without
  // it the insert still lands (the text is set synchronously).
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
    <div data-testid="office-page" style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <h1>{t('office.title')}</h1>
      <nav data-testid="office-tabs" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {OFFICE_TABS.map(tb => (
          <button
            key={tb}
            data-testid={`office-tab-${tb}`}
            onClick={() => setTab(tb)}
            style={{ fontWeight: tab === tb ? 600 : 400 }}
          >
            {t(`office.tabs.${tb}`)}
          </button>
        ))}
      </nav>

      {tab === 'writing' && (
        // DropZone (L22) wraps the writing surface so dropped docs/images land
        // here; the attached names are surfaced below the writing view.
        <DropZone
          onAttach={(files) => setAttached(files.map(f => f.name))}
          onCopied={(names) => setAttached(prev => [...prev, ...names])}
        >
          <WritingView />
        </DropZone>
      )}
      {attached.length > 0 && <div data-testid="office-attached">📎 {attached.join(', ')}</div>}

      {tab === 'pdf' && <Suspense fallback={null}><PdfReaderPage /></Suspense>}

      {tab === 'composer' && (
        <div>
          <VoiceInputButton onText={insertToComposer} />
          <textarea
            ref={composerRef}
            data-testid="office-composer"
            value={composer}
            onChange={e => setComposer(e.target.value)}
            rows={8}
            style={{ width: '100%', marginTop: 8 }}
          />
        </div>
      )}

      {tab === 'templates' && <PromptTemplatesPage onInsert={insertToComposer} />}

      {tab === 'search' && <SearchProvidersPage />}
    </div>
  );
}
