// Pure video-link helpers for the office video-summary channel (D9).
// Renderer-safe (no node:* imports) so they live in core and are unit-testable.
// parseVideoUrl/fetchVideoMeta stay pure (parse + oembed injected); summarizeVideo
// builds the chat prompt and throws a CLEAR error when no transcript is available —
// the main channel catches that and returns { ok:false } instead of sending an
// empty/undefined prompt to chatText.

export type VideoPlatform = 'youtube' | 'bilibili' | 'unknown';
export interface VideoMeta { platform: VideoPlatform; id: string | null; title?: string }

export function parseVideoUrl(url: string): VideoMeta {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt) return { platform: 'youtube', id: yt[1] };
  const bl = /bilibili\.com\/video\/(BV[\w]+)/.exec(url);
  if (bl) return { platform: 'bilibili', id: bl[1] };
  return { platform: 'unknown', id: null };
}

// The main process passes an oembed fetcher (youtube/bilibili oEmbed JSON); the
// injected callback keeps this function pure. A null oembed response (fetch
// failure / non-ok) leaves title undefined, which is fine — the summary prompt
// simply omits the title. Unknown platforms short-circuit (no network call).
export async function fetchVideoMeta(
  url: string,
  parse: (url: string) => VideoMeta,
  oembed: (url: string) => Promise<{ title?: string } | null>,
): Promise<VideoMeta> {
  const meta = parse(url);
  if (meta.platform === 'unknown') return meta;
  const res = await oembed(url);
  return { ...meta, title: res?.title };
}

export function summarizeVideo(meta: VideoMeta, transcript: string | undefined): string {
  if (!transcript || transcript.trim().length < 20) {
    throw new Error('未配置 transcript API/Whisper,无法获取视频字幕(见设置→办公→视频)。');
  }
  return `请总结以下视频${meta.title ? `《${meta.title}》` : ''}(${meta.platform} ${meta.id})的要点:\n\n${transcript.slice(0, 12000)}`;
}
