/** Shared provider field validation (main IPC + renderer). */

/** http(s) URL: host (domain / IPv4 / localhost), optional port, optional path/query/hash. No userinfo. */
export const PROVIDER_BASE_URL_PATTERN =
  /^https?:\/\/(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|localhost)(?::\d{1,5})?(?:\/[^\s]*)?$/i;

/** Provider name / model display name: Chinese ideographs, Latin letters, digits, hyphen, underscore. */
export const PROVIDER_NAME_PATTERN = /^[\u4e00-\u9fffA-Za-z0-9_-]+$/;

/** Model ID: Latin letters, digits, hyphen, underscore. */
export const PROVIDER_MODEL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ProviderBaseUrlError =
  | 'URL_PROTOCOL_REQUIRED'
  | 'URL_INVALID'
  | 'URL_CREDENTIALS_FORBIDDEN';

export function providerBaseUrlError(raw: string): ProviderBaseUrlError | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'URL_PROTOCOL_REQUIRED';
  if (!/^https?:\/\//i.test(trimmed)) return 'URL_PROTOCOL_REQUIRED';
  // user:pass@host — forbid credentials in the address
  if (/^https?:\/\/[^/?#]*@/i.test(trimmed)) return 'URL_CREDENTIALS_FORBIDDEN';
  if (!PROVIDER_BASE_URL_PATTERN.test(trimmed)) return 'URL_INVALID';
  return null;
}

export function sanitizeProviderNameInput(raw: string): string {
  return raw.replace(/[^\u4e00-\u9fffA-Za-z0-9_-]/g, '');
}

export function isValidProviderName(name: string): boolean {
  return PROVIDER_NAME_PATTERN.test(name);
}

export function sanitizeProviderModelIdInput(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '');
}

export function isValidProviderModelId(modelId: string): boolean {
  return PROVIDER_MODEL_ID_PATTERN.test(modelId);
}

/** Same charset rules as provider name. */
export const sanitizeProviderModelNameInput = sanitizeProviderNameInput;
export const isValidProviderModelName = isValidProviderName;
