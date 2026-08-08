import { providerBaseUrlError } from '@jarvis/protocol';

/** Structural checks for persisted provider base URLs (no DNS). Outbound calls still use SafeUrlPolicy. */
export function assertProviderBaseUrlShape(raw: string): URL {
  const err = providerBaseUrlError(raw);
  if (err) throw new Error(err);
  return new URL(raw.trim());
}
