import type Database from 'better-sqlite3';

export interface SettingsStore {
  get(key: string, fallback?: unknown): unknown;
  set(key: string, value: unknown): void;
  getAll(): Record<string, unknown>;
}

export function createSettingsStore(db: Database.Database): SettingsStore {
  return {
    get(key, fallback) {
      const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
      if (!row) return fallback;
      return JSON.parse(row.value_json);
    },
    set(key, value) {
      db.prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
      ).run(key, JSON.stringify(value));
    },
    getAll() {
      const rows = db.prepare('SELECT key, value_json FROM settings').all() as Array<{ key: string; value_json: string }>;
      return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value_json)]));
    }
  };
}
