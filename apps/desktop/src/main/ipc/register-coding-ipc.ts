import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { IndexStore, hashEmbedding, type TreeNode } from '@jarvis/core';
import { createCodeIndexAdapter, reindexWorkspace, applyDiffToFile, readDiffFile, createSnapshotStore } from './coding';
import { searchMentions } from './mention';
import { createWorkspaceIpc } from './workspace';
import { setLastPickedFile, readLastPickedFile } from './picked-file';
import { assertAllowedWorkspaceRoot, assertWorkspaceRelPath } from './workspace-path-guard';
import type { createAgentStore } from './agents';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type Register = (channel: string, handler: Handler) => void;

/** Code panel, index, diff, mention, and dialog IPC. */
export function registerCodingIpc(
  register: Register,
  db: Database.Database,
  agents: ReturnType<typeof createAgentStore>,
  getWorkspace: () => string | null,
): void {
  const workspaceIpc = createWorkspaceIpc(getWorkspace);
  const boundRoots = () => agents.list().filter(a => a.workspaceId).map(a => a.workspaceId!);
  register(IpcChannel.workspaceTree, () => workspaceIpc.tree());
  register(IpcChannel.workspaceRead, (_e, rel) => workspaceIpc.read(rel as string));
  register('workspace.copyFiles', (_e, paths) => workspaceIpc.copyFiles(paths as string[]));
  const codeIndex = new IndexStore(createCodeIndexAdapter(db), hashEmbedding);
  register(IpcChannel.indexReindex, async (_e, args) => {
    const { workspaceRoot } = args as { workspaceRoot: string };
    try {
      const allowed = assertAllowedWorkspaceRoot(workspaceRoot, getWorkspace, boundRoots);
      const res = await reindexWorkspace(codeIndex, allowed);
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  register('index.search', (_e, args) => {
    const { query, limit } = args as { query: string; limit?: number };
    return codeIndex.search(query, limit ?? 5);
  });
  const snapshotStore = createSnapshotStore(db);
  register(IpcChannel.diffApplyAll, (_e, args) => {
    const { taskId, path, accepts } = args as { taskId: string; path: string; accepts: boolean[] };
    const ws = getWorkspace();
    if (!ws) return { ok: false, error: 'no workspace' };
    try {
      const safePath = assertWorkspaceRelPath(ws, path);
      return applyDiffToFile(ws, safePath, accepts, taskId, snapshotStore);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  register(IpcChannel.diffRead, (_e, args) => {
    const { taskId, path } = args as { taskId: string; path: string };
    const ws = getWorkspace();
    if (!ws) return { ok: false, error: 'no workspace' };
    try {
      const safePath = assertWorkspaceRelPath(ws, path);
      return readDiffFile(ws, safePath, taskId, snapshotStore);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const flattenTree = (nodes: TreeNode[]): Array<{ path: string; type: string }> => {
    const out: Array<{ path: string; type: string }> = [];
    const walk = (ns: TreeNode[]) => { for (const n of ns) { out.push({ path: n.path, type: n.type }); walk(n.children); } };
    walk(nodes);
    return out;
  };
  register('mention.search', async (_e, query) => {
    return searchMentions(query as string, codeIndex, agents.list(), () => flattenTree(workspaceIpc.tree()));
  });
  register(IpcChannel.dialogOpenFile, async (_e, ...args) => {
    const { dialog } = await import('electron');
    const opts = args[0] as { filters?: Array<{ name: string; extensions: string[] }> } | undefined;
    if (opts && typeof opts === 'object') {
      const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: opts.filters ?? [] });
      const path = r.canceled ? '' : r.filePaths[0] ?? '';
      if (path) setLastPickedFile(path);
      return { path };
    }
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  register('config.readPickedFile', async (_e, path) => {
    const result = readLastPickedFile(path as string);
    if (typeof result === 'string') return result;
    return result;
  });
  register('dialog.saveText', async (_e, args) => {
    try {
      const { defaultName, content } = (args ?? {}) as { defaultName: string; content: string };
      const { dialog } = await import('electron');
      const { writeFile } = await import('node:fs/promises');
      const r = await dialog.showSaveDialog({ defaultPath: defaultName });
      if (r.canceled || !r.filePath) return { ok: false as const };
      await writeFile(r.filePath, content, 'utf8');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
