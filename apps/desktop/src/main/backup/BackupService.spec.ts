import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { BackupService } from './BackupService';

describe('BackupService', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jarvis-backup-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a backup db file under backups dir', async () => {
    const db = new Database(join(dir, 'main.db'));
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('x')");
    const svc = new BackupService(db, join(dir, 'backups'));
    const file = await svc.createBackup();
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(join(dir, 'backups')).length).toBe(1);
    expect(svc.list()[0].name.endsWith('.db')).toBe(true);
    db.close();
  });

  it('restore swaps the working db by copy', async () => {
    const mainPath = join(dir, 'main2.db');
    const db = new Database(mainPath);
    db.exec('CREATE TABLE t (v TEXT)');
    db.prepare("INSERT INTO t (v) VALUES ('original')").run();
    const svc = new BackupService(db, join(dir, 'backups'), mainPath);
    const file = await svc.createBackup();
    // Mutate the working db after the backup; restore must revert it.
    db.prepare("INSERT INTO t (v) VALUES ('after-backup')").run();
    await svc.restore(file);
    // restore closes the service's db handle; reopen the mainPath file fresh.
    const reopened = new Database(mainPath);
    const rows = reopened.prepare('SELECT v FROM t').all() as Array<{ v: string }>;
    reopened.close();
    expect(rows).toEqual([{ v: 'original' }]);
  });

  it('createBackup after restore is a safe no-op (closed-handle guard)', async () => {
    const mainPath = join(dir, 'main3.db');
    const db = new Database(mainPath);
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('x')");
    const svc = new BackupService(db, join(dir, 'backups'), mainPath);
    const file = await svc.createBackup();
    await svc.restore(file);
    // restore closes the db handle; a subsequent best-effort backup (e.g. the
    // will-quit hook) must NOT reject on the closed connection.
    await expect(svc.createBackup()).resolves.toBe('');
  });
});
