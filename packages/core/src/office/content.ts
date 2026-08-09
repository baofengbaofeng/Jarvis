// Multimodal message content (L23).
//
// Pure module — no `node:*` imports — so it is safe to re-export from the
// renderer entry (`@jarvis/core/renderer`) where the ImageAttachment component
// pulls `isImageUrl` at runtime. The OpenAI/Anthropic adapters call
// `normalizeContent` to map the generic array shape into each API's message
// format; the ChatService serializes arrays into the chat_messages TEXT column.

export type MessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export function toContentArray(content: string, imageUrls: string[]): MessageContent {
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  if (content) parts.push({ type: 'text', text: content });
  for (const u of imageUrls) parts.push({ type: 'image_url', image_url: { url: u } });
  // An empty composer must not produce `[{text:''}]`; return a plain string so
  // the message stays a string and the caller's string path is untouched.
  return parts.length === 0 ? '' : parts;
}

export function isImageUrl(url: string): boolean {
  return /^data:image\//i.test(url) || /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url);
}

// Type guard for the content-array shape. Used by the ChatService when it
// deserializes the TEXT column: a parsed string is only accepted as an array if
// every part matches the union, so user text that merely looks like JSON is
// never mis-parsed (validation-on-parse, documented in ChatService).
/** True when content is a multimodal array that includes at least one image part. */
export function contentHasImages(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((p) => {
    if (!p || typeof p !== 'object') return false;
    return (p as { type?: unknown }).type === 'image_url';
  });
}

export function isContentArray(content: unknown): content is NonNullable<MessageContent> {
  // An empty array is not a valid content message (toContentArray returns ''
  // for zero parts) — `.every` would vacuously accept it.
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((p) => {
    if (!p || typeof p !== 'object') return false;
    const part = p as { type?: unknown; text?: unknown; image_url?: unknown };
    if (part.type === 'text') return typeof part.text === 'string';
    if (part.type === 'image_url') {
      const u = (part as { image_url?: { url?: unknown } }).image_url;
      return !!u && typeof u.url === 'string';
    }
    return false;
  });
}

export function normalizeContent(content: MessageContent, adapter: 'openai' | 'anthropic'): unknown {
  if (typeof content === 'string') return content;
  if (adapter === 'openai') {
    // The generic array already matches OpenAI's content-part format; rebuild it
    // so the shape is canonical regardless of how the parts were constructed.
    return content.map(p => p.type === 'image_url' ? { type: 'image_url', image_url: { url: p.image_url.url } } : { type: 'text', text: p.text });
  }
  // anthropic: image_url parts become image content blocks
  // { type:'image', source:{ type:'base64', media_type, data } } — media_type is
  // taken from the data URL's `data:<mime>;base64,<data>` header pair.
  return content.map(p => p.type === 'image_url' ? toAnthropicImage(p.image_url.url) : { type: 'text', text: p.text });
}

// Anthropic's image source block only accepts base64 data URLs. A remote https
// URL (or any non-data URL) cannot be represented as a base64 image — the old
// code naively split the URL and produced the WHOLE url as `media_type` with
// empty `data` (a broken request). Minimal safe behavior: degrade a non-data URL
// to a text placeholder that names the URL, so the message still sends and the
// user sees exactly what could not be attached as an image (instead of a silent
// empty-data block or a hard throw that drops the whole message).
function toAnthropicImage(url: string): unknown {
  if (!url.startsWith('data:image/')) {
    return { type: 'text', text: `[图片: ${url}]` };
  }
  return { type: 'image', source: { type: 'base64', media_type: url.split(';')[0].replace('data:', ''), data: url.split(',')[1] ?? '' } };
}
