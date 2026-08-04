export async function* parseSSE(body: ReadableStream<Uint8Array> | null, onEvent?: (eventName: string, data: string) => void): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); }
      else if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        onEvent?.(eventName, data);
        yield data;
        eventName = '';
      }
    }
  }
}
