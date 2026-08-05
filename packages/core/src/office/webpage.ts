// Pure main-text extractor for the WebView one-click summary (I8/D8).
// Renderer-safe (no node:* imports) so it lives in core and is unit-testable.
//
// Strategy: strip script/style plus common boilerplate regions (nav/footer/
// header/aside), strip tags, normalize entities/whitespace, then keep the
// longest text blocks as the article body. CJK text is information-dense, so a
// modest absolute-length cutoff (~20 chars) retains short article paragraphs
// while dropping one-line menu/footer noise.
export function extractMainText(html: string): string {
  const withoutBoilerplate = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  const noTags = withoutBoilerplate.replace(/<[^>]+>/g, ' ');
  const cleaned = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ');
  const blocks = cleaned.split(/\s*\n\s*/).map(s => s.trim()).filter(s => s.length > 0);
  const main = blocks.filter(s => s.length > 20);
  if (main.length === 0) return cleaned.replace(/\s+/g, ' ').trim();
  return main.sort((a, b) => b.length - a.length).slice(0, 5).join('\n');
}

// Security gate for WebView URLs: only http(s) is allowed (reject file:,
// javascript:, data:, etc.). Uses the WHATWG URL parser so malformed strings
// are rejected rather than guessed at.
export function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
