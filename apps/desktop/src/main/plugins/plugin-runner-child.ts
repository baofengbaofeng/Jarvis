/**
 * Restricted plugin utility-process entry.
 *
 * Receives approved source via the first RPC frame (never a filesystem path).
 * Runs under Node's permission model (--experimental-permission, --no-addons).
 */
import vm from 'node:vm';
import {
  assertStaticPluginCode,
  decodeRpcFrame,
  encodeRpcFrame,
  type PluginManifest,
  type PluginPermission,
  type RestrictedPluginContext,
  type ToolDef,
} from '../../../../../packages/core/src/plugins/protocol';

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: RestrictedPluginContext,
) => Promise<{ ok: boolean; output: string }>;

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

function getParentPort(): ParentPort | null {
  const port = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
  return port ?? null;
}

function send(msg: Parameters<typeof encodeRpcFrame>[0]): void {
  const port = getParentPort();
  if (!port) return;
  port.postMessage(encodeRpcFrame(msg));
}

function sandboxAvailable(): { ok: boolean; reason?: string } {
  const perm = (process as NodeJS.Process & {
    permission?: { has: (scope: string, path?: string) => boolean };
  }).permission;
  if (!perm || typeof perm.has !== 'function') {
    return { ok: false, reason: 'process.permission missing' };
  }
  // Electron utilityProcess requires --allow-fs-read=* to load the child entry
  // (realpath/asar). Child/worker must still be denied; FS for plugin code is
  // enforced by the frozen VM + static import ban.
  if (perm.has('child') || perm.has('worker')) {
    return { ok: false, reason: 'child/worker not denied' };
  }
  return { ok: true };
}

async function receiveApprovedSourceFrame(): Promise<{
  code: string;
  manifest: PluginManifest;
  permissions: PluginPermission[];
}> {
  const port = getParentPort();
  if (!port) {
    throw new Error('PLUGIN_NO_PARENT_PORT');
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PLUGIN_START_TIMEOUT')), 2_000);
    port.on('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        const msg = decodeRpcFrame(raw);
        if (msg.type !== 'source') return;
        clearTimeout(timer);
        resolve({ code: msg.code, manifest: msg.manifest, permissions: msg.permissions });
      } catch (err) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

async function main(): Promise<void> {
  const check = sandboxAvailable();
  if (!check.ok) {
    send({ type: 'sandbox', available: false, reason: check.reason });
    send({ type: 'error', code: 'PLUGIN_SANDBOX_UNAVAILABLE', message: check.reason ?? '' });
    process.exit(1);
  }
  send({ type: 'sandbox', available: true });

  const { code, permissions } = await receiveApprovedSourceFrame();
  assertStaticPluginCode(code);

  const handlers = new Map<string, ToolHandler>();
  const tools: ToolDef[] = [];

  const registerTool = (
    def: ToolDef,
    handler: ToolHandler,
  ): void => {
    tools.push(def);
    handlers.set(def.name, handler);
  };

  const context = vm.createContext(Object.freeze({
    registerTool,
    console: Object.freeze({ log: () => {}, error: () => {} }),
  }), {
    codeGeneration: { strings: false, wasm: false },
  });

  new vm.Script(`"use strict";\n${code}`, { filename: 'plugin-entry.js' })
    .runInContext(context, { timeout: 1000 });

  send({ type: 'register', tools });
  send({ type: 'ready' });

  const port = getParentPort();
  if (!port) return;

  port.on('message', async (event) => {
    let raw: string;
    try {
      raw = typeof event.data === 'string' ? event.data : String(event.data);
      const msg = decodeRpcFrame(raw);
      if (msg.type === 'shutdown') {
        process.exit(0);
        return;
      }
      if (msg.type !== 'invoke') return;

      const handler = handlers.get(msg.tool);
      if (!handler) {
        send({ type: 'error', id: msg.id, code: 'PLUGIN_TOOL_UNKNOWN', message: msg.tool });
        return;
      }

      const restricted: RestrictedPluginContext = {
        cwd: msg.context.cwd,
        workspaceRoot: msg.context.workspaceRoot,
        permissions: permissions.filter((p) => msg.context.permissions.includes(p)),
      };

      try {
        const result = await handler(msg.args, restricted);
        send({ type: 'result', id: msg.id, result });
      } catch (err) {
        send({
          type: 'error',
          id: msg.id,
          code: 'PLUGIN_INVOKE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      send({
        type: 'error',
        code: err instanceof Error && err.message === 'PLUGIN_FRAME_TOO_LARGE'
          ? 'PLUGIN_FRAME_TOO_LARGE'
          : 'PLUGIN_FRAME_INVALID',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

void main().catch((err) => {
  try {
    send({
      type: 'error',
      code: 'PLUGIN_BOOT_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  } catch { /* ignore */ }
  process.exit(1);
});
