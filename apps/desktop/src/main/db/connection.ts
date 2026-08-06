import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function jarvisDataDir(): string {
  const dir = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function openDatabase(): Database.Database {
  const dir = jarvisDataDir();
  mkdirSync(join(dir, 'backups'), { recursive: true });
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const db = new Database(join(dir, 'jarvis.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
