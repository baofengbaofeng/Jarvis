import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from '../db/migrations';
import { createSettingsStore } from '../ipc/settings';
import { SearchSecretMigration } from './SearchSecretMigration';
import { BackupService } from '../backup/BackupService';
import { createConfigIpc } from '../ipc/config';

describe('SearchSecretMigration', () => {
  let db: Database.Database;
  let settings: ReturnType<typeof createSettingsStore>;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    settings = createSettingsStore(db);
  });

  it('writes, reads back, then transactionally removes plaintext', async () => {
    settings.set('search_providers', [{ type: 'serper', apiKey: 'search-secret-123', enabled: true }]);
    const secrets = new Map<string, string>();
    const migration = new SearchSecretMigration(db, {
      set: async (k, v) => { secrets.set(k, v); },
      get: async k => secrets.get(k) ?? null,
      delete: async k => { secrets.delete(k); },
    });
    expect(await migration.run()).toEqual({ ok: true, migrated: 1 });
    const raw = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('search_providers') as { value_json: string };
    expect(raw.value_json).not.toContain('search-secret-123');
    expect(JSON.parse(raw.value_json)[0]).toMatchObject({ type: 'serper', apiKeyRef: 'search:serper:key', enabled: true });
    expect(secrets.get('search:serper:key')).toBe('search-secret-123');
  });

  it('keeps plaintext but blocks search when read-back confirmation fails', async () => {
    settings.set('search_providers', [{ type: 'brave', apiKey: 'keep-me', enabled: true }]);
    const migration = new SearchSecretMigration(db, {
      set: async () => {}, get: async () => null, delete: async () => {},
    });
    expect(await migration.run()).toEqual({ ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' });
    expect(settings.get('search_providers')).toEqual([{ type: 'brave', apiKey: 'keep-me', enabled: true }]);
  });

  it('leaves no plaintext in db, wal, backup or export after checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-search-mig-'));
    const dbPath = join(dir, 'jarvis.db');
    const backupDir = join(dir, 'backups');
    const secret = 'search-secret-never-on-disk';
    try {
      const fileDb = new Database(dbPath);
      applyMigrations(fileDb);
      const fileSettings = createSettingsStore(fileDb);
      fileSettings.set('search_providers', [{ type: 'serper', apiKey: secret, enabled: true }]);
      const secrets = new Map<string, string>();
      const migration = new SearchSecretMigration(fileDb, {
        set: async (k, v) => { secrets.set(k, v); },
        get: async k => secrets.get(k) ?? null,
        delete: async k => { secrets.delete(k); },
      });
      expect(await migration.run()).toEqual({ ok: true, migrated: 1 });
      fileDb.pragma('wal_checkpoint(TRUNCATE)');
      const backup = new BackupService(fileDb, backupDir, dbPath);
      const backupPath = await backup.createBackup();
      for (const file of [dbPath, `${dbPath}-wal`, backupPath].filter(existsSync)) {
        expect(readFileSync(file).includes(Buffer.from(secret))).toBe(false);
      }
      const exported = createConfigIpc(fileDb).exportConfig('json');
      expect(exported).not.toContain(secret);
      expect(exported).toContain('search:serper:key');
      fileDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
