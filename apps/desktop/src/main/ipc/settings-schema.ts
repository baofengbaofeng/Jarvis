export type SandboxLevel = 'readonly' | 'readwrite' | 'system';

export interface AgentPermissions {
  level: SandboxLevel;
  allowCommands: string[];
  allowDomains: string[];
}

const SANDBOX_LEVELS = new Set<SandboxLevel>(['readonly', 'readwrite', 'system']);

/** Keys that may be written via settings.set / config.import. */
const ALLOWED_KEYS = new Set([
  'locale',
  'theme',
  'proxy_json',
  'data_policy.local_only',
  'search_providers',
  'image.api_key_ref',
  'image.base_url',
  'image.model_id',
  'transcript.api_key_ref',
  'transcript.base_url',
  'multica.conflicts',
  'concurrency.per_agent',
  'concurrency.machine',
  'shortcuts',
  'onboarding.completed',
  // Renderer settings-store / init-store use this key (legacy alias of onboarding.completed).
  'onboarding_done',
]);

export function isAllowedSettingsKey(key: string): boolean {
  if (ALLOWED_KEYS.has(key)) return true;
  if (key.startsWith('permissions.')) return true;
  return false;
}

export function validateSettingsValue(key: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isAllowedSettingsKey(key)) {
    return { ok: false, error: 'SETTINGS_KEY_INVALID' };
  }
  if (key.startsWith('permissions.')) {
    return validatePermissions(value);
  }
  if (key === 'concurrency.per_agent' || key === 'concurrency.machine') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 64) {
      return { ok: false, error: 'SETTINGS_CONCURRENCY_INVALID' };
    }
    return { ok: true, value: Math.floor(value) };
  }
  return { ok: true, value };
}

function validatePermissions(value: unknown): { ok: true; value: AgentPermissions } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'SETTINGS_PERMISSIONS_INVALID' };
  const v = value as Record<string, unknown>;
  const level = v.level;
  if (typeof level !== 'string' || !SANDBOX_LEVELS.has(level as SandboxLevel)) {
    return { ok: false, error: 'SETTINGS_PERMISSIONS_INVALID' };
  }
  const allowCommands = Array.isArray(v.allowCommands) ? v.allowCommands.filter((x): x is string => typeof x === 'string') : [];
  const allowDomains = Array.isArray(v.allowDomains) ? v.allowDomains.filter((x): x is string => typeof x === 'string') : [];
  return { ok: true, value: { level: level as SandboxLevel, allowCommands, allowDomains } };
}

/** Reject elevating to system without an explicit confirm flag on the payload. */
export function requiresSystemConfirm(key: string, value: unknown): boolean {
  if (!key.startsWith('permissions.')) return false;
  const v = value as { level?: string; confirmSystem?: boolean } | null;
  return v?.level === 'system' && v?.confirmSystem !== true;
}
