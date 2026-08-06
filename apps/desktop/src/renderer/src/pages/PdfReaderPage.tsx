import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as pdfjs from 'pdfjs-dist';
import type { PickedCapability } from '../components/office/DropZone';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface ExtractResult {
  ok: boolean;
  pages?: number;
  pageTexts?: string[];
  data?: string;
  error?: string;
}

export function PdfReaderPage() {
  const { t } = useTranslation('common');
  const [picked, setPicked] = useState<PickedCapability | null>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<string>('');

  const hasFile = picked !== null;

  const pickFile = async () => {
    const caps = (await window.jarvis.invoke('dialog.pickPath', { purpose: 'office-file' })) as PickedCapability[];
    if (caps[0]) {
      setPicked(caps[0]);
      setError('');
      setSummary('');
      setPages(0);
      setPage(1);
      dataRef.current = '';
    }
  };

  const extract = useCallback(async (): Promise<ExtractResult | null> => {
    if (!picked) return null;
    try {
      const r = (await window.jarvis.invoke('office.pdf.extract', { capability: picked.token })) as ExtractResult;
      if (!r.ok) { setError(r.error ?? t('pdf.error')); return null; }
      setError('');
      setPages(r.pages ?? 0);
      dataRef.current = r.data ?? '';
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [picked, t]);

  const renderPage = useCallback(async (p: number) => {
    const canvas = canvasRef.current;
    if (!picked || !canvas) return;
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
        await pdfPage.render({ canvas, viewport }).promise;
      } finally {
        void doc.loadingTask.destroy();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [picked, extract]);

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
    if (!picked) return;
    setLoading(true);
    try {
      const r = (await window.jarvis.invoke('office.pdf.summarize', { capability: picked.token, from, to })) as { ok: boolean; result?: string; error?: string };
      if (r.ok) { setSummary(r.result ?? ''); setError(''); }
      else setError(r.error ?? t('pdf.error'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [picked, t]);

  const summarizePage = useCallback(() => void summarize(page, page), [summarize, page]);
  const summarizeAll = useCallback(() => void summarize(1, pages || 9999), [summarize, pages]);

  return (
    <div data-testid="pdf-reader">
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button data-testid="pdf-pick" type="button" onClick={() => void pickFile()} disabled={loading}>
          {picked?.name ?? t('pdf.pickFile')}
        </button>
        <button data-testid="pdf-open" onClick={() => void load()} disabled={!hasFile || loading}>{t('pdf.open')}</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button data-testid="pdf-summarize-page" onClick={summarizePage} disabled={!hasFile || loading || !pages}>{t('pdf.summarizePage')}</button>
        <button data-testid="pdf-summarize" onClick={summarizeAll} disabled={!hasFile || loading || !pages}>{t('pdf.summarize')}</button>
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
