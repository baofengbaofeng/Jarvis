import type Database from 'better-sqlite3';
import { MessageBus } from '@jarvis/core';

// The bus is a module-level singleton: every M6 squad feature (task
// orchestrator, delegation, external agents) shares ONE in-memory routing
// fabric (L12, §13.3). Main owns persistence — see createBusPersist.
let bus: MessageBus | null = null;
export function getMessageBus(): MessageBus {
  if (!bus) bus = new MessageBus();
  return bus;
}

// Subscribes the bus to the main-owned agent_messages table so EVERY posted
// message is durable. Returns the unsubscribe handle. Column names must match
// migration v4 (id, kind, from_agent, to_agent, task_id, payload_json,
// created_at).
export function createBusPersist(db: Database.Database, bus: MessageBus): () => void {
  const ins = db.prepare('INSERT INTO agent_messages (id, kind, from_agent, to_agent, task_id, payload_json, created_at) VALUES (?,?,?,?,?,?,?)');
  return bus.subscribe(m => {
    ins.run(m.id, m.kind, m.from, m.to, m.taskId ?? null, JSON.stringify(m.payload), new Date(m.ts).toISOString());
  });
}
