import { createHash } from 'node:crypto';
import { join, isAbsolute, normalize, sep } from 'node:path';
import type { ToolDef } from '../agent/types';

export type PluginPermission = 'workspace:read' | 'workspace:write' | 'model:invoke';

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  entry: string;
  permissions: PluginPermission[];
}

export interface PluginDescriptor {
  manifest: PluginManifest;
  root: string;
  entryPath: string;
  sha256: string;
}

export interface RegisteredPluginTool {
  definition: ToolDef;
}

export const MAX_RPC_FRAME_BYTES = 256 * 1024;

export type RpcMessage =
  | { type: 'source'; code: string; manifest: PluginManifest; permissions: PluginPermission[] }
  | { type: 'ready' }
  | { type: 'register'; tools: ToolDef[] }
  | { type: 'invoke'; id: string; tool: string; args: Record<string, unknown>; context: RestrictedPluginContext }
  | { type: 'result'; id: string; result: { ok: boolean; output: string } }
  | { type: 'error'; id?: string; code: string; message: string }
  | { type: 'shutdown' }
  | { type: 'sandbox'; available: boolean; reason?: string };

/** Subset of ToolContext capabilities granted to a plugin via RPC. */
export interface RestrictedPluginContext {
  cwd: string;
  workspaceRoot?: string;
  permissions: PluginPermission[];
}

export interface PluginFs {
  readText: (path: string) => string;
  realpath: (path: string) => string;
}

const ALLOWED_PERMISSIONS = new Set<PluginPermission>([
  'workspace:read',
  'workspace:write',
  'model:invoke',
]);

const IMPORT_FORBIDDEN =
  /\bimport\s*(?:[\s\w*{,}$]*\s*from\s*)?['"][^'"]+['"]|\bimport\s*\(|\brequire\s*\(/;

export function validatePluginManifest(manifest: PluginManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error('PLUGIN_MANIFEST_INVALID');
  }
  if (!manifest.id || !manifest.name || typeof manifest.entry !== 'string') {
    throw new Error('PLUGIN_MANIFEST_INVALID');
  }
  if (!Array.isArray(manifest.permissions)
    || manifest.permissions.some(p => !ALLOWED_PERMISSIONS.has(p))) {
    throw new Error('PLUGIN_MANIFEST_INVALID');
  }
  assertContainedEntry(manifest.entry);
}

function assertContainedEntry(entry: string): void {
  if (!entry || isAbsolute(entry) || entry.includes('\0')) {
    throw new Error('PLUGIN_ENTRY_INVALID');
  }
  const normalized = normalize(entry);
  if (normalized.startsWith('..') || normalized.split(sep).includes('..')) {
    throw new Error('PLUGIN_ENTRY_INVALID');
  }
  if (normalized.includes(':') && process.platform === 'win32') {
    throw new Error('PLUGIN_ENTRY_INVALID');
  }
}

export function assertStaticPluginCode(code: string): void {
  if (IMPORT_FORBIDDEN.test(code)) {
    throw new Error('PLUGIN_IMPORT_FORBIDDEN');
  }
}

export function hashPluginSource(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function describePlugin(root: string, fs: PluginFs): PluginDescriptor {
  const manifestRaw = fs.readText(join(root, 'plugin.json'));
  const parsed = JSON.parse(manifestRaw) as PluginManifest;
  validatePluginManifest(parsed);

  const entryJoined = join(root, parsed.entry);
  const entryReal = fs.realpath(entryJoined);
  const rootReal = fs.realpath(root);
  const rootPrefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  if (entryReal !== rootReal && !entryReal.startsWith(rootPrefix)) {
    throw new Error('PLUGIN_ENTRY_INVALID');
  }

  const source = fs.readText(entryReal);
  assertStaticPluginCode(source);
  return {
    manifest: parsed,
    root: rootReal,
    entryPath: entryReal,
    sha256: hashPluginSource(source),
  };
}

function frameByteLength(raw: string): number {
  return Buffer.byteLength(raw, 'utf8');
}

export function encodeRpcFrame(message: RpcMessage): string {
  const json = JSON.stringify(message);
  if (frameByteLength(json) > MAX_RPC_FRAME_BYTES) {
    throw new Error('PLUGIN_FRAME_TOO_LARGE');
  }
  return json;
}

export function decodeRpcFrame(raw: string): RpcMessage {
  if (frameByteLength(raw) > MAX_RPC_FRAME_BYTES) {
    throw new Error('PLUGIN_FRAME_TOO_LARGE');
  }
  return JSON.parse(raw) as RpcMessage;
}
