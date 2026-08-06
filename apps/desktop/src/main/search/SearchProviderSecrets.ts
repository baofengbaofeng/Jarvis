import type Database from 'better-sqlite3';
import type { SearchProviderConfig, SearchProviderType } from '@jarvis/core';
import type { AuditSink } from '@jarvis/core';
import type { SecureStorage } from '../secrets/SecureStorage';
import { createSettingsStore } from '../ipc/settings';

export interface SearchProviderView {
  type: SearchProviderType;
  enabled: boolean;
  hasKey: boolean;
}

export interface SearchProviderSaveInput {
  type: SearchProviderType;
  apiKey?: string;
  enabled: boolean;
}

function refFor(type: SearchProviderType): string {
  return `search:${type}:key`;
}

function readStored(db: Database.Database): SearchProviderConfig[] {
  const settings = createSettingsStore(db);
  const raw = settings.get('search_providers');
  return Array.isArray(raw) ? raw as SearchProviderConfig[] : [];
}

export class SearchProviderSecrets {
  constructor(
    private db: Database.Database,
    private secrets: Pick<SecureStorage, 'set' | 'get' | 'delete'>,
    private audit?: AuditSink,
  ) {}

  getConfigs(): SearchProviderView[] {
    return readStored(this.db).map(cfg => ({
      type: cfg.type,
      enabled: cfg.enabled,
      hasKey: Boolean(cfg.apiKeyRef),
    }));
  }

  async save(inputs: SearchProviderSaveInput[]): Promise<SearchProviderView[]> {
    const settings = createSettingsStore(this.db);
    const prev = readStored(this.db);
    const prevRefs = new Map(prev.map(c => [c.type, c.apiKeyRef]));
    const next: SearchProviderConfig[] = [];

    for (const input of inputs) {
      const ref = refFor(input.type);
      if (input.apiKey !== undefined && input.apiKey !== '') {
        await this.secrets.set(ref, input.apiKey);
        if (await this.secrets.get(ref) !== input.apiKey) {
          throw new Error('SEARCH_API_KEY_REQUIRED');
        }
      } else if (prevRefs.get(input.type)) {
        // keep existing ref
      } else if (input.enabled) {
        throw new Error('SEARCH_API_KEY_REQUIRED');
      }
      const hasRef = Boolean(input.apiKey) || Boolean(prevRefs.get(input.type));
      if (hasRef || input.enabled) {
        next.push({ type: input.type, apiKeyRef: ref, enabled: input.enabled });
      }
    }

    const nextTypes = new Set(next.map(c => c.type));
    const removed = prev.filter(c => !nextTypes.has(c.type));

    settings.set('search_providers', next);

    for (const cfg of removed) {
      if (!cfg.apiKeyRef) continue;
      try {
        await this.secrets.delete(cfg.apiKeyRef);
      } catch {
        this.audit?.write({
          ts: new Date().toISOString(),
          kind: 'config',
          actor: 'user',
          action: 'search_provider.delete_key',
          target: cfg.type,
          result: 'error',
          detail: 'keychain delete failed (redacted)',
        });
        throw new Error('SEARCH_KEY_DELETE_RETRY');
      }
    }

    return this.getConfigs();
  }
}
