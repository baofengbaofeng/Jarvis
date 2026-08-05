import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// M6 Task 9 (L31): agent config version history + rollback. Main owns the
// store; the pure diff/changedFields helpers live in @jarvis/core squad/agents.
// getAgent/applyAgent are injected by the caller (createAgentStore) so a
// rollback writes through the SAME row-write path as a normal update without
// duplicating column logic, and without re-triggering a snapshot (see the
// applyRaw wiring in agents.ts — snapshot-before-write happens only in update).
export function createAgentVersionStore(db: Database.Database, getAgent: (id: string) => Record<string, unknown>, applyAgent: (cfg: Record<string, unknown>) => void) {
  const ins = db.prepare('INSERT INTO agent_config_versions (id, agent_id, snapshot_json, created_at) VALUES (?,?,?,?)');
  return {
    snapshot(agentId: string) {
      const cfg = getAgent(agentId);
      ins.run(randomUUID(), agentId, JSON.stringify(cfg), new Date().toISOString());
    },
    list(agentId: string) {
      return (db.prepare('SELECT * FROM agent_config_versions WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as Array<Record<string, unknown>>).map(r => ({
        id: r.id as string, createdAt: r.created_at as string, fields: Object.keys(JSON.parse(r.snapshot_json as string))
      }));
    },
    // M6 Task 9 (L31) review fix: agentId is scoped into the SELECT (defense in
    // depth) so even a direct rollback call without the IPC cross-agent guard
    // cannot apply another agent's snapshot. The IPC layer always passes it.
    rollback(versionId: string, agentId?: string) {
      const v = agentId
        ? (db.prepare('SELECT snapshot_json FROM agent_config_versions WHERE id = ? AND agent_id = ?').get(versionId, agentId) as { snapshot_json: string } | undefined)
        : (db.prepare('SELECT snapshot_json FROM agent_config_versions WHERE id = ?').get(versionId) as { snapshot_json: string } | undefined);
      if (!v) throw new Error(`version ${versionId} not found`);
      applyAgent(JSON.parse(v.snapshot_json));
    }
  };
}
