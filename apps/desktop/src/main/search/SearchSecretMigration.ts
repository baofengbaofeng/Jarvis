import { readFileSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { SearchProviderConfig, SearchProviderType } from '@jarvis/core';
import type { SecureStorage } from '../secrets/SecureStorage';
import { createSettingsStore } from '../ipc/settings';

type LegacySearchProvider = { type: SearchProviderType; apiKey: string; enabled: boolean };

export type SearchMigrationResult =
  | { ok: true; migrated: number }
  | { ok: false; error: 'SEARCH_SECRET_MIGRATION_REQUIRED' };

function isLegacyConfig(item: unknown): item is LegacySearchProvider {
  return typeof item === 'object' && item !== null
    && typeof (item as LegacySearchProvider).type === 'string'
    && typeof (item as LegacySearchProvider).apiKey === 'string'
    && (item as LegacySearchProvider).apiKey.length > 0;
}

function fileContainsSecret(dbPath: string, secrets: string[]): boolean {
  for (const file of [dbPath, `${dbPath}-wal`]) {
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    for (const secret of secrets) {
      if (buf.includes(Buffer.from(secret))) return true;
    }
  }
  return false;
}

// SEC-07: migrate legacy plaintext search_providers.apiKey into SecureStorage,
// replace settings with apiKeyRef-only rows, and scrub DB/WAL pages.
export class SearchSecretMigration {
  constructor(
    private db: Database.Database,
    private secrets: Pick<SecureStorage, 'set' | 'get' | 'delete'>,
  ) {}

  async run(): Promise<SearchMigrationResult> {
    const settings = createSettingsStore(this.db);
    const raw = settings.get('search_providers');
    if (!Array.isArray(raw)) return { ok: true, migrated: 0 };

    const legacyConfigs = raw.filter(isLegacyConfig);
    if (legacyConfigs.length === 0) {
      for (const cfg of raw as SearchProviderConfig[]) {
        if (cfg.apiKeyRef && !await this.secrets.get(cfg.apiKeyRef)) {
          return { ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' };
        }
      }
      return { ok: true, migrated: 0 };
    }

    const migrated: SearchProviderConfig[] = [];
    const plaintextSecrets = legacyConfigs.map(c => c.apiKey);

    try {
      for (const cfg of legacyConfigs) {
        const ref = `search:${cfg.type}:key`;
        await this.secrets.set(ref, cfg.apiKey);
        if (await this.secrets.get(ref) !== cfg.apiKey) {
          return { ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' };
        }
        migrated.push({ type: cfg.type, apiKeyRef: ref, enabled: cfg.enabled });
      }

      this.db.pragma('secure_delete = ON');
      this.db.transaction(() => settings.set('search_providers', migrated))();
    } catch {
      return { ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' };
    }

    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
      const dbPath = (this.db as unknown as { name?: string }).name;
      if (dbPath && dbPath !== ':memory:' && fileContainsSecret(dbPath, plaintextSecrets)) {
        return { ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' };
      }
    } catch {
      return { ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' };
    }

    return { ok: true, migrated: legacyConfigs.length };
  }
}
