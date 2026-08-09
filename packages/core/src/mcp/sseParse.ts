/** Minimal SSE block parser for MCP HTTP transports (no EventSource dependency). */
export function parseSseChunk(
  buffer: string,
  onEvent: (event: { event: string; data: string }) => void,
): string {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    if (!block.trim() || block.startsWith(':')) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) onEvent({ event, data: dataLines.join('\n') });
  }
  return rest;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
