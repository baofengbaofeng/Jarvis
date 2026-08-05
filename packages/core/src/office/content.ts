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
export function isContentArray(content: unknown): content is NonNullable<MessageContent> {
  if (!Array.isArray(content)) return false;
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
  return content.map(p => p.type === 'image_url'
    ? { type: 'image', source: { type: 'base64', media_type: p.image_url.url.split(';')[0].replace('data:', ''), data: p.image_url.url.split(',')[1] ?? '' } }
    : { type: 'text', text: p.text });
}
