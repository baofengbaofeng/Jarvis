// D15 prompt template library — pure {{var}} extraction/substitution helpers.
// Renderer-safe (no node:* imports), used both by the main store's render IPC
// and by the renderer page for a local insert preview.

export function listTemplateVars(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) out.push(m[1]);
  return [...new Set(out)];
}

export function substituteTemplate(text: string, vars: Record<string, string>): string {
  // `k in vars` would match inherited properties (constructor, toString,
  // __proto__), leaking the value instead of the spec's "unbound var → empty".
  // Object.hasOwn only matches the caller's own keys.
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (Object.hasOwn(vars, k) ? vars[k] : ''));
}
