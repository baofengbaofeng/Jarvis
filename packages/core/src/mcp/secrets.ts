import type { SecretOrPlain } from './config';

export function isSecretRef(v: unknown): v is { secretRef: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { secretRef?: unknown }).secretRef === 'string'
    && !!(v as { secretRef: string }).secretRef.trim();
}

export function secretRefKey(v: SecretOrPlain): string | undefined {
  return isSecretRef(v) ? v.secretRef.trim() : undefined;
}

/**
 * Resolve a map of plain strings / secret refs into plaintext values.
 * Missing refs are omitted (caller decides fail-closed).
 */
export function mapSecretPlainRecord(
  record: Record<string, SecretOrPlain> | undefined,
  resolve: (ref: string) => string | undefined,
): Record<string, string> {
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string') {
      out[k] = v;
      continue;
    }
    if (isSecretRef(v)) {
      const resolved = resolve(v.secretRef);
      if (resolved !== undefined) out[k] = resolved;
    }
  }
  return out;
}
