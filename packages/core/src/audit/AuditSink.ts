export type AuditKind = 'tool_call' | 'approval' | 'auth' | 'config';
export type AuditResult = 'ok' | 'denied' | 'error';
export interface AuditEntry {
  ts: string; kind: AuditKind; actor?: string; action: string; target?: string;
  result: AuditResult; taskId?: string; detail?: string;
}
export interface AuditSink { write(e: AuditEntry): void }
export class MemorySink implements AuditSink {
  private entries: AuditEntry[] = [];
  write(e: AuditEntry): void { this.entries.push(e); }
  all(): AuditEntry[] { return this.entries; }
}
