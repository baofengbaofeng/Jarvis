export { IpcChannel, IpcEvent } from './ipc-channels';

export {
  APP_VERSION,
  APP_DISPLAY_NAME,
  GITHUB_REPO_URL,
  GITHUB_ISSUES_URL,
  GITHUB_WIKI_URL,
  CONFIG_SCHEMA_VERSION,
  LEGACY_CONFIG_SCHEMA_VERSION,
  INSTALLER_ARTIFACT_VERSION,
  INSTALLER_ARTIFACTS,
} from './version';

export {
  ALLOWED_INVOKE,
  ALLOWED_EVENTS,
  assertAllowedInvoke,
  assertAllowedEvent,
} from './ipc-allowlist';

export type ProviderType = 'openai-compatible' | 'anthropic-compatible';

/** Max lengths for provider fields (aligned with SQLite CHECKs in migration v13). */
export const PROVIDER_FIELD_MAX = {
  name: 64,
  baseUrl: 2048,
  /** Plaintext token in keychain — not a DB column; enforced in IPC + UI. */
  apiKey: 512,
  apiKeyRef: 128,
  /** Model id / display name — enforced in IPC + UI (no DB length CHECK yet). */
  modelId: 128,
  modelName: 64,
  /** Digits before K/M in the model context UI. */
  contextDigits: 6,
  /** Absolute context window after unit conversion (100M tokens). */
  contextTokens: 100_000_000,
} as const;

/** Max lengths for MCP server fields (IPC + UI). */
export const MCP_FIELD_MAX = {
  name: 64,
  command: 512,
  args: 2048,
} as const;

/** Max lengths for Skills import / display fields (IPC + UI). */
export const SKILL_FIELD_MAX = {
  name: 64,
  url: 2048,
  path: 2048,
  description: 512,
} as const;

/** Concurrency settings bounds (settings.concurrency). */
export const CONCURRENCY_FIELD_MAX = {
  perAgentMin: 1,
  perAgentMax: 64,
  machineMin: 1,
  machineMax: 512,
} as const;

/** Agent env/cli text area limits. */
export const ENV_FIELD_MAX = {
  envText: 8192,
  cliText: 2048,
  key: 128,
  value: 2048,
} as const;

export {
  PROVIDER_BASE_URL_PATTERN,
  PROVIDER_NAME_PATTERN,
  PROVIDER_MODEL_ID_PATTERN,
  providerBaseUrlError,
  sanitizeProviderNameInput,
  isValidProviderName,
  sanitizeProviderModelIdInput,
  isValidProviderModelId,
  sanitizeProviderModelNameInput,
  isValidProviderModelName,
} from './provider-fields';
export type { ProviderBaseUrlError } from './provider-fields';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKeyRef: string;      // Keychain 引用,不落盘明文
  /** When false, hidden from chat/agent model selection. Omit/undefined = enabled. */
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Model {
  id: string;
  providerId: string;
  modelId: string;        // 用户自定义 model id,禁止硬编码预设
  name: string;
  /** Absolute context window in tokens; null/undefined = unset. */
  contextTokens?: number | null;
  /** When false (or parent provider disabled), hidden from selection. Omit = enabled. */
  enabled?: boolean;
  createdAt: string;
}

/** Model row eligible for Agent / chat binding (provider + model both enabled). */
export interface SelectableModel {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  contextTokens?: number | null;
}

export type ContextTokenUnit = 'K' | 'M';

export function contextTokensFromInput(value: number, unit: ContextTokenUnit): number {
  return unit === 'M' ? value * 1_000_000 : value * 1_000;
}

export function formatContextTokens(tokens: number | null | undefined): string | null {
  if (tokens == null) return null;
  const n = typeof tokens === 'number' ? tokens : Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n % 1_000 === 0) return `${n / 1_000}K`;
  return String(n);
}

export interface AgentConfig {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  workspaceId: string | null;   // C7
  contextBudgetTokens: number;  // L17
  planOnly: boolean;            // E10
  // L13 squad context passing: the strategy used to shape what the leader's
  // delegation context becomes before it reaches THIS agent when it runs as a
  // squad member. Mirrors core's ContextPassingStrategy under structural
  // typing (protocol cannot depend on @jarvis/core).
  contextPassing?: 'full' | 'summary' | 'conclusion' | 'custom';
  // Parsed from env_vars_json / cli_args_json (I1, C9). Not persisted columns
  // themselves; exposed so the EnvSettingsPage can pre-load and round-trip them
  // instead of wiping on a blank save.
  envVars?: Record<string, string>;
  cliArgs?: string[];
  createdAt: string;
  updatedAt: string;
}
export type Agent = AgentConfig;

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

// L23 multimodal: a message may carry a content array (text + image_url parts)
// in addition to a plain string. Kept self-contained here because protocol
// cannot depend on @jarvis/core; it is structurally identical to core's
// MessageContent, so the two are interchangeable under structural typing.
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
export type ChatContent = string | ChatContentPart[];

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: ChatContent;         // D13 markdown 由渲染层解析 (string); L23 content array for multimodal
  toolCalls?: unknown;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface Task {
  id: string;
  agentId: string;
  status: TaskStatus;
  payloadJson: string;
  resultJson: string | null;
  errorJson: string | null;
  multicaTaskId: string | null;  // L36
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Settings {
  [key: string]: unknown;
}

export interface EnvInfo {
  nodeVersion: string;
  goVersion: string | null;
  gitVersion: string | null;
  daemonRunning: boolean;
  agentCliOnPath: boolean;
}

export interface DiagnosticsReport {
  env: EnvInfo;
  checkedAt: string;
  items: Array<{ id: string; ok: boolean; detail: string }>;
}
