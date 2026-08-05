import type { WipeService } from '../wipe/WipeService';
import type { WipeScope } from '@jarvis/core';

// L20 (M8 Task 5): `wipe.run` IPC. Delegates straight to the service; a
// confirmation-phrase mismatch rejects the channel and the renderer's WipePane
// surfaces the message (no { ok, error } wrapper — the error text IS the payload).
export function createWipeIpc(svc: WipeService) {
  return {
    run: async (_e: unknown, scope: WipeScope, phrase: string) => svc.wipe(scope, phrase),
  };
}
