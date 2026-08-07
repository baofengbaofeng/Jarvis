/** Strip one optional leading space after the field colon (WHATWG SSE). */
function fieldValue(line: string, prefixLen: number): string {
  const raw = line.slice(prefixLen);
  return raw.startsWith(' ') ? raw.slice(1) : raw;
}

/**
 * Parse a Server-Sent Events body into data payloads.
 * CORE-16: multi-line `data:` fields are joined with `\n` and dispatched on a
 * blank line (or stream end); the reader is always cancelled/released so an
 * early consumer `break` cannot leak the stream lock.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array> | null,
  onEvent?: (eventName: string, data: string) => void,
): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  const dataLines: string[] = [];

  const dispatch = function* (): Generator<string> {
    if (dataLines.length === 0) {
      eventName = '';
      return;
    }
    const data = dataLines.join('\n');
    dataLines.length = 0;
    const name = eventName;
    eventName = '';
    onEvent?.(name, data);
    yield data;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line === '') {
          yield* dispatch();
        } else if (line.startsWith('event:')) {
          eventName = fieldValue(line, 6);
        } else if (line.startsWith('data:')) {
          dataLines.push(fieldValue(line, 5));
        }
        // ignore comments / other fields
      }
    }
    // Flush a trailing incomplete event (common for LLM streams that omit the
    // final blank line before close).
    if (buffer.length > 0) {
      const line = buffer.replace(/\r$/, '');
      buffer = '';
      if (line.startsWith('event:')) eventName = fieldValue(line, 6);
      else if (line.startsWith('data:')) dataLines.push(fieldValue(line, 5));
    }
    yield* dispatch();
  } finally {
    try {
      await reader.cancel();
    } catch { /* already closed / cancelled */ }
    try {
      reader.releaseLock();
    } catch { /* already released by cancel in some runtimes */ }
  }
}
