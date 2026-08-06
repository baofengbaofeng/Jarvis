import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as pdfjs from 'pdfjs-dist';

// pdfjs-dist ships its parsing worker as a static asset; Vite resolves this URL
// at build time and emits the worker file into the renderer bundle. Parsing then
// runs off the main thread so canvas rendering does not jank the UI.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface ExtractResult {
  ok: boolean;
  pages?: number;
  pageTexts?: string[];
  data?: string; // base64 of the raw PDF bytes so the renderer can paint to canvas
  error?: string;
}

export function PdfReaderPage() {
  const { t } = useTranslation('common');
  const [path, setPath] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Cache the raw bytes from the first extract so turning pages does not re-read
  // and re-parse the PDF in the main process; the renderer still re-runs
  // getDocument per page, which the task explicitly accepts.
  const dataRef = useRef<string>('');

  const hasPath = path.trim().length > 0;

  // Ask main for the page texts + raw bytes. Every window.jarvis invoke is
  // wrapped so a rejected IPC (missing file, unreadable PDF) surfaces as an
  // inline error instead of an unhandled rejection.
  const extract = useCallback(async (): Promise<ExtractResult | null> => {
    if (!hasPath) return null;
    try {
      const r = (await window.jarvis.invoke('office.pdf.extract', path)) as ExtractResult;
      if (!r.ok) { setError(r.error ?? t('pdf.error')); return null; }
      setError('');
      setPages(r.pages ?? 0);
      dataRef.current = r.data ?? '';
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [path, hasPath, t]);

  // Paint page `p` to the canvas via a fresh getDocument (data cached from the
  // first extract). Guarded against an empty path and a missing canvas element.
  const renderPage = useCallback(async (p: number) => {
    const canvas = canvasRef.current;
    if (!hasPath || !canvas) return;
    if (!dataRef.current) {
      const ext = await extract();
      if (!ext?.data) return;
    }
    setLoading(true);
    try {
      const bytes = Uint8Array.from(atob(dataRef.current), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      try {
        const pdfPage = await doc.getPage(p);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // v6 render prefers the canvas itself (pdfjs creates the 2D context);
        // canvasContext is a legacy escape hatch.
        await pdfPage.render({ canvas, viewport }).promise;
      } finally {
        // PDFDocumentProxy carries no destroy(); the owning loading task does.
        void doc.loadingTask.destroy();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hasPath, extract]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ext = await extract();
      if (ext?.ok) {
        setPage(1);
        await renderPage(1);
      }
    } finally {
      setLoading(false);
    }
  }, [extract, renderPage]);

  const summarize = useCallback(async (from: number, to: number) => {
    if (!hasPath) return;
    setLoading(true);
    try {
      const r = (await window.jarvis.invoke('office.pdf.summarize', path, from, to)) as { ok: boolean; result?: string; error?: string };
      if (r.ok) { setSummary(r.result ?? ''); setError(''); }
      else setError(r.error ?? t('pdf.error'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path, hasPath, t]);

  const summarizePage = useCallback(() => void summarize(page, page), [summarize, page]);
  const summarizeAll = useCallback(() => void summarize(1, pages || 9999), [summarize, pages]);

  return (
    <div data-testid="pdf-reader">
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <input
          data-testid="pdf-path"
          value={path}
          placeholder={t('pdf.path')}
          disabled={loading}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
        />
        <button data-testid="pdf-open" onClick={() => void load()} disabled={!hasPath || loading}>{t('pdf.open')}</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button data-testid="pdf-summarize-page" onClick={summarizePage} disabled={!hasPath || loading || !pages}>{t('pdf.summarizePage')}</button>
        <button data-testid="pdf-summarize" onClick={summarizeAll} disabled={!hasPath || loading || !pages}>{t('pdf.summarize')}</button>
      </div>
      <canvas ref={canvasRef} data-testid="pdf-canvas" />
      {pages > 0 && (
        <div data-testid="pdf-pager" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button data-testid="pdf-prev" onClick={() => void renderPage(page - 1).then(() => setPage((p) => Math.max(1, p - 1)))} disabled={page <= 1 || loading} aria-label={t('pdf.prevPage')}>‹</button>
          <span data-testid="pdf-page">{t('pdf.page', { page, total: pages })}</span>
          <button data-testid="pdf-next" onClick={() => void renderPage(page + 1).then(() => setPage((p) => Math.min(pages, p + 1)))} disabled={page >= pages || loading} aria-label={t('pdf.nextPage')}>›</button>
        </div>
      )}
      {error && <div data-testid="pdf-error" role="alert" style={{ color: 'var(--danger, #c00)' }}>{error}</div>}
      {loading && <div data-testid="pdf-loading">{t('pdf.loading')}</div>}
      {summary && <div data-testid="pdf-summary" style={{ whiteSpace: 'pre-wrap' }}>{summary}</div>}
    </div>
  );
}
