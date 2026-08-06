import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WritingView } from '../components/office/WritingView';
import { VoiceInputButton } from '../components/office/VoiceInputButton';
import { DropZone } from '../components/office/DropZone';
import { SearchProvidersPage } from '../components/office/SearchProvidersPage';
import { WebViewSummary } from '../components/office/WebViewSummary';
import { VideoSummary } from '../components/office/VideoSummary';
import { ImageGenerator } from '../components/office/ImageGenerator';
import { GlobalSearch } from '../components/office/GlobalSearch';
import { PromptTemplatesPage } from './PromptTemplatesPage';
// classifyFile (files.ts) is a pure module, safe for the renderer entry.
import { classifyFile } from '@jarvis/core/renderer';

// PdfReaderPage is lazy-loaded: pdfjs-dist's browser build references
// browser-only globals (DOMMatrix) at module scope, so pulling it into the
// office page's initial chunk would break render-time on non-DOM runtimes and
// bloat the aggregate bundle. Lazy + Suspense keeps the PDF reader (and its
// worker asset) out until the PDF tab is actually opened.
const PdfReaderPage = lazy(() => import('./PdfReaderPage').then(m => ({ default: m.PdfReaderPage })));

// D12 文件分析 is NOT a separate tab: the DropZone attach path (writing tab) runs
// office.file.analyze per dropped doc, and the PDF tab covers pdf files — those
// two ARE the D12 runnable entries.
type OfficeTab = 'writing' | 'pdf' | 'composer' | 'templates' | 'search' | 'web' | 'video' | 'image' | 'globalsearch';
const OFFICE_TABS: OfficeTab[] = ['writing', 'pdf', 'composer', 'templates', 'search', 'web', 'video', 'image', 'globalsearch'];

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
  // Per-file office.file.analyze results (D12/L22): name + ok/error + text.
  const [analysis, setAnalysis] = useState<Array<{ name: string; status: 'ok' | 'error'; text: string }>>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // L22/D12 attach wiring: dropped docs (pdf/docx/xlsx/pptx) are analyzed via
  // office.file.analyze — the D12 renderer entry. Images are surfaced as plain
  // attachments (they can be pasted into the composer later); other kinds are
  // routed to workspace.copyFiles by DropZone before reaching onAttach. Every
  // invoke is wrapped (Task 1 convention) and errors are surfaced per file.
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
        // here; docs are analyzed via handleAttach (D12), other files are copied
        // to the workspace by DropZone, and the attached names surface below.
        <DropZone onAttach={(files) => void handleAttach(files)} onCopied={(names) => setAttached(prev => [...prev, ...names])}>
          <WritingView />
        </DropZone>
      )}
      {attached.length > 0 && <div data-testid="office-attached">📎 {attached.join(', ')}</div>}
      {analysis.length > 0 && (
        <div data-testid="office-analysis" style={{ marginTop: 8 }}>
          <h3 style={{ margin: '4px 0' }}>{t('officeTools.analysis')}</h3>
          {analysis.map((a, i) => (
            <div key={`${a.name}-${i}`} data-testid={`office-analysis-${i}`} style={{ marginBottom: 6 }}>
              <strong>{a.name}</strong> — {a.status === 'ok' ? a.text : `${t('officeTools.error')}: ${a.text}`}
            </div>
          ))}
        </div>
      )}

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

      {tab === 'web' && <WebViewSummary />}

      {tab === 'video' && <VideoSummary />}

      {tab === 'image' && <ImageGenerator />}

      {tab === 'globalsearch' && <GlobalSearch />}
    </div>
  );
}
