package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open opens (and initializes if needed) the JARVIS SQLite DB. WAL + a single
// connection (§13.3): the daemon writes only its owned tables.
func Open(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1)
	if _, err := d.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		_ = d.Close()
		return nil, err
	}
	if err := ensureSchema(d); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}

// ensureSchema creates only daemon-owned tables. The profile table is named
// daemon_runtime_profiles (NOT runtime_profiles): the main app's migration v1
// already owns `runtime_profiles(id, name, config_json, created_at)` with a
// different schema, and §13.3 says the daemon writes only its owned tables.
func ensureSchema(d *sql.DB) error {
	_, err := d.Exec(`
		CREATE TABLE IF NOT EXISTS daemon_runtime_profiles (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			concurrency_per_agent INTEGER NOT NULL DEFAULT 6,
			concurrency_machine INTEGER NOT NULL DEFAULT 20,
			env_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`)
	return err
}

// ModelInfo is one row of the main-owned `models` table (read-only here, H1.9).
type ModelInfo struct {
	ID         string `json:"id"`
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
	Name       string `json:"name,omitempty"`
}

func ListModels(ctx context.Context, d *sql.DB) ([]ModelInfo, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT m.id, m.provider_id, m.model_id, COALESCE(m.name, '') FROM models m ORDER BY m.provider_id, m.model_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModelInfo{}
	for rows.Next() {
		var m ModelInfo
		if err := rows.Scan(&m.ID, &m.ProviderID, &m.ModelID, &m.Name); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Profile is one runtime profile row (H1.14) from the daemon-owned
// daemon_runtime_profiles table.
type Profile struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	ConcurrencyPerAgent int               `json:"concurrencyPerAgent"`
	ConcurrencyMachine  int               `json:"concurrencyMachine"`
	Env                 map[string]string `json:"env,omitempty"`
}

func ListProfiles(ctx context.Context, d *sql.DB) ([]Profile, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT id, name, concurrency_per_agent, concurrency_machine, env_json FROM daemon_runtime_profiles ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		var p Profile
		var env string
		if err := rows.Scan(&p.ID, &p.Name, &p.ConcurrencyPerAgent, &p.ConcurrencyMachine, &env); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(env), &p.Env); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func GetProfile(ctx context.Context, d *sql.DB, id string) (*Profile, error) {
	row := d.QueryRowContext(ctx,
		`SELECT id, name, concurrency_per_agent, concurrency_machine, env_json FROM daemon_runtime_profiles WHERE id = ?`, id)
	var p Profile
	var env string
	if err := row.Scan(&p.ID, &p.Name, &p.ConcurrencyPerAgent, &p.ConcurrencyMachine, &env); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if err := json.Unmarshal([]byte(env), &p.Env); err != nil {
		return nil, err
	}
	return &p, nil
}

func UpsertProfile(ctx context.Context, d *sql.DB, p Profile) error {
	if p.Env == nil {
		p.Env = map[string]string{}
	}
	env, err := json.Marshal(p.Env)
	if err != nil {
		return err
	}
	_, err = d.ExecContext(ctx, `
		INSERT INTO daemon_runtime_profiles (id, name, concurrency_per_agent, concurrency_machine, env_json)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			concurrency_per_agent = excluded.concurrency_per_agent,
			concurrency_machine = excluded.concurrency_machine,
			env_json = excluded.env_json`,
		p.ID, p.Name, p.ConcurrencyPerAgent, p.ConcurrencyMachine, string(env))
	if err != nil {
		return fmt.Errorf("upsert profile %s: %w", p.ID, err)
	}
	return nil
}

// MapTaskIDs links a local task to its Multica task id (L36). A nonzero
// RowsAffected is required: mapping a nonexistent local task would otherwise
// silently succeed and lose the L36 mapping.
func MapTaskIDs(ctx context.Context, d *sql.DB, localTaskID, multicaTaskID string) error {
	if multicaTaskID == "" {
		return nil
	}
	res, err := d.ExecContext(ctx,
		`UPDATE tasks SET multica_task_id = ? WHERE id = ?`, multicaTaskID, localTaskID)
	if err != nil {
		return fmt.Errorf("map task ids %s->%s: %w", localTaskID, multicaTaskID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("map task ids %s->%s: no such local task", localTaskID, multicaTaskID)
	}
	return nil
}

// MulticaTaskIDByLocal resolves a Multica task id from a local task id.
func MulticaTaskIDByLocal(ctx context.Context, d *sql.DB, localTaskID string) (string, error) {
	var id sql.NullString
	err := d.QueryRowContext(ctx, `SELECT multica_task_id FROM tasks WHERE id = ?`, localTaskID).Scan(&id)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return id.String, nil
}
