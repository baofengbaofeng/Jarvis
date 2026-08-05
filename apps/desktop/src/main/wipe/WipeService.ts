import { rmSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { confirmPhrase, DEFAULT_WIPE_TABLES, type WipeScope, type WipeResult } from '@jarvis/core';

// L20 (M8 Task 5): sensitive-data wipe. `wipe` deletes rows from the
// DEFAULT_WIPE_TABLES allowlist (any other table name is skipped), deletes the
// Keychain API keys when scope.keychain, removes the active workspace root when
// scope.workspace && workspaceRoot, then checkpoints + VACUUMs so the freed
// space is returned to the OS. The confirmation phrase is required: a mismatch
// throws before anything is touched. The keychain adapter is injected (the real
// one is built in IpcRouter over SecureStorage, whose delete is async), which
// is also why `wipe` is async — the pure DELETE loop stays synchronous.
export class WipeService {
  constructor(
    private db: Database,
    private keychain: { deleteAllApiKeys: () => Promise<number> },
    private workspaceRoot?: string,
  ) {}

  async wipe(scope: WipeScope, phrase: string): Promise<WipeResult> {
    if (phrase !== confirmPhrase(scope)) throw new Error('confirmation phrase mismatch');
    const deleted: Record<string, number> = {};
    for (const table of scope.tables) {
      if (!DEFAULT_WIPE_TABLES.includes(table)) continue;
      const info = this.db.prepare(`DELETE FROM ${table}`).run();
      deleted[table] = info.changes;
    }
    const keychainDeleted = scope.keychain ? await this.keychain.deleteAllApiKeys() : 0;
    let workspaceRemoved = false;
    if (scope.workspace && this.workspaceRoot) {
      rmSync(this.workspaceRoot, { recursive: true, force: true });
      workspaceRemoved = true;
    }
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.exec('VACUUM');
    return { deleted, keychainDeleted, workspaceRemoved, vacuumed: true };
  }
}
