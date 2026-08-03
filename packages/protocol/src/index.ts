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
  createdAt: string;
  updatedAt: string;
}
export type Agent = AgentConfig;

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;              // D13 markdown 由渲染层解析
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
