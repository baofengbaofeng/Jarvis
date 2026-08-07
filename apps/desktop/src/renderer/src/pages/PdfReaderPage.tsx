import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Panel } from '@jarvis/ui';
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
    <Panel data-testid="pdf-reader" className="pdf-reader">
      <div className="pdf-reader__toolbar">
        <Button data-testid="pdf-pick" type="button" variant="ghost" onClick={() => void pickFile()} disabled={loading}>
          {picked?.name ?? t('pdf.pickFile')}
        </Button>
        <Button data-testid="pdf-open" variant="ghost" onClick={() => void load()} disabled={!hasFile || loading}>{t('pdf.open')}</Button>
      </div>
      <div className="pdf-reader__toolbar">
        <Button data-testid="pdf-summarize-page" variant="ghost" onClick={summarizePage} disabled={!hasFile || loading || !pages}>{t('pdf.summarizePage')}</Button>
        <Button data-testid="pdf-summarize" variant="ghost" onClick={summarizeAll} disabled={!hasFile || loading || !pages}>{t('pdf.summarize')}</Button>
      </div>
      <canvas ref={canvasRef} data-testid="pdf-canvas" className="pdf-reader__canvas" />
      {pages > 0 && (
        <div data-testid="pdf-pager" className="pdf-reader__pager">
          <Button data-testid="pdf-prev" size="sm" variant="ghost" onClick={() => void renderPage(page - 1).then(() => setPage((p) => Math.max(1, p - 1)))} disabled={page <= 1 || loading} aria-label={t('pdf.prevPage')}>‹</Button>
          <span data-testid="pdf-page">{t('pdf.page', { page, total: pages })}</span>
          <Button data-testid="pdf-next" size="sm" variant="ghost" onClick={() => void renderPage(page + 1).then(() => setPage((p) => Math.min(pages, p + 1)))} disabled={page >= pages || loading} aria-label={t('pdf.nextPage')}>›</Button>
        </div>
      )}
      {error && <div data-testid="pdf-error" role="alert" className="error-text">{error}</div>}
      {loading && <div data-testid="pdf-loading" className="empty-text">{t('pdf.loading')}</div>}
      {summary && <div data-testid="pdf-summary" className="office-tool__result">{summary}</div>}
    </Panel>
  );
}
