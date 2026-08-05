// L20 (M8 Task 5): sensitive-data wipe strategy — pure, renderer-safe.
// The scope + confirmation phrase live in core so both the main-process
// WipeService and the renderer's WipePane share ONE source of truth for the
// table allowlist and the required phrase.

export interface WipeScope {
  tables: string[];
  keychain: boolean;
  workspace: boolean;
}

// The full L20 wipe range. The WipeService deletes exactly these tables (and
// refuses any other table name), plus the Keychain when scope.keychain and the
// active workspace root when scope.workspace.
export const DEFAULT_WIPE_TABLES = [
  'chat_sessions',
  'chat_messages',
  'audit_logs',
  'token_usage',
  'tasks',
  'agent_messages',
  'agent_call_edges',
];

export function confirmPhrase(scope: WipeScope): string {
  return scope.keychain ? 'DELETE ALL' : 'DELETE';
}

// Per-table deleted counts + keychain/workspace/vacuum outcome returned by the
// main-process WipeService to the renderer (shown as diagnostic JSON).
export interface WipeResult {
  deleted: Record<string, number>;
  keychainDeleted: number;
  workspaceRemoved: boolean;
  vacuumed: boolean;
}
