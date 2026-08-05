import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// D10 renderer entry: text-to-image. prompt + size → office.image.generate
// (OpenAI-compatible endpoint only; the key comes from settings image.api_key_ref).
// When no key is configured the channel returns the clear "未配置图像生成 API Key"
// error — display it inline per D10 no-silent-failure, and show the returned
// image URLs as thumbnails on success.
const SIZES = ['256x256', '512x512', '1024x1024'] as const;

export function ImageGenerator() {
  const { t } = useTranslation('common');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<string>('1024x1024');
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError('');
    setUrls([]);
    try {
      const r = (await window.jarvis.invoke('office.image.generate', { prompt: prompt.trim(), size })) as { ok: boolean; urls?: Array<{ url: string }>; error?: string };
      if (r.ok) setUrls((r.urls ?? []).map(u => u.url));
      else setError(r.error ?? t('officeTools.error'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="image-generator">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          data-testid="image-prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={t('officeTools.promptPlaceholder')}
          style={{ minWidth: 320 }}
        />
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {t('officeTools.size')}
          <select data-testid="image-size" value={size} onChange={e => setSize(e.target.value)}>
            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button data-testid="image-generate" onClick={() => void generate()} disabled={busy}>
          {t('officeTools.generate')}
        </button>
      </div>
      {error && <div data-testid="image-error" role="alert">{error}</div>}
      {urls.length > 0 && (
        <div data-testid="image-result" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {urls.map(u => <img key={u} src={u} alt={prompt} width={120} style={{ border: '1px solid #ddd', borderRadius: 4 }} />)}
        </div>
      )}
    </div>
  );
}
