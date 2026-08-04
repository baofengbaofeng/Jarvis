import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createSettingsStore } from './settings';

describe('settings store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('get returns default when missing', () => {
    const s = createSettingsStore(db);
    expect(s.get('language', 'zh-CN')).toBe('zh-CN');
  });

  it('set then get round-trips JSON values', () => {
    const s = createSettingsStore(db);
    s.set('language', 'en');
    s.set('window_mode', 'snap');
    expect(s.get('language', '')).toBe('en');
    expect(s.get('window_mode', '')).toBe('snap');
  });

  it('persists across store instances', () => {
    createSettingsStore(db).set('onboarding_done', true);
    expect(createSettingsStore(db).get('onboarding_done', false)).toBe(true);
  });
});
