export const IpcChannel = {
  settingsGet: 'settings.get',
  settingsSet: 'settings.set',
  providerList: 'provider.list',
  providerCreate: 'provider.create',
  providerUpdate: 'provider.update',
  providerDelete: 'provider.delete',
  agentList: 'agent.list',
  agentCreate: 'agent.create',
  agentUpdate: 'agent.update',
  agentDelete: 'agent.delete',
  taskCreate: 'task.create',
  taskCancel: 'task.cancel',
  taskPause: 'task.pause',
  taskRetry: 'task.retry',
  chatSend: 'chat.send',
  daemonStatus: 'daemon.status',
  daemonRestart: 'daemon.restart',
  secretsSet: 'secrets.set',
  secretsGet: 'secrets.get',
  secretsDelete: 'secrets.delete',
  dialogOpenFile: 'dialog.openFile',
  diagnosticsRun: 'diagnostics.run',
  envInfo: 'diagnostics.env',
} as const;

export const IpcEvent = {
  chatDelta: 'chat:delta',
  chatDone: 'chat:done',
  taskLog: 'task:log',
  taskState: 'task:state',
  taskComplete: 'task:complete',
  taskFailed: 'task:failed',
  squadStatus: 'squad:status',
  // I5 (M6 Task 8): main pushes terminal task/squad outcomes as in-app toasts.
  toastPush: 'toast:push',
} as const;

export type ProviderType = 'openai-compatible' | 'anthropic-compatible';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKeyRef: string;      // Keychain 引用,不落盘明文
  createdAt: string;
  updatedAt: string;
}

export interface Model {
  id: string;
  providerId: string;
  modelId: string;        // 用户自定义 model id,禁止硬编码预设
  name: string;
  createdAt: string;
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
