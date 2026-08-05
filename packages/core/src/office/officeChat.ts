export interface ChatRouterLike { chat(req: { messages: Array<{ role: string; content: unknown }> }): AsyncIterable<{ deltaText?: string }> }

export async function chatText(router: ChatRouterLike, messages: Array<{ role: string; content: unknown }>): Promise<string> {
  let out = '';
  // `await` the stream first: a ChatRouterLike.chat may return the AsyncIterable
  // directly OR a Promise resolving to one (e.g. `async () => fake()`), and
  // `for await` does not iterate over a Promise itself. Awaiting a plain
  // iterable is a no-op pass-through, so this covers both shapes.
  const stream = await router.chat({ messages });
  for await (const c of stream) out += c.deltaText ?? '';
  return out.trim();
}
