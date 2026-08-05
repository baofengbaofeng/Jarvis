package db

import (
	"context"
	"database/sql"
	"testing"
)

func mustOpen(t *testing.T) *sql.DB {
	t.Helper()
	d, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func TestListModels(t *testing.T) {
	d := mustOpen(t)
	if _, err := d.Exec(`CREATE TABLE models (
		id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
		name TEXT, created_at TEXT NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO models VALUES ('m1','prov-1','claude-sonnet-4-6','Sonnet','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	models, err := ListModels(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ModelID != "claude-sonnet-4-6" {
		t.Fatalf("unexpected models: %+v", models)
	}
}

func TestProfileRoundTrip(t *testing.T) {
	d := mustOpen(t)
	p := Profile{ID: "dev", Name: "Development", ConcurrencyPerAgent: 2, ConcurrencyMachine: 4, Env: map[string]string{"LOG_LEVEL": "debug"}}
	if err := UpsertProfile(context.Background(), d, p); err != nil {
		t.Fatal(err)
	}
	got, err := GetProfile(context.Background(), d, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.ConcurrencyPerAgent != 2 || got.Env["LOG_LEVEL"] != "debug" {
		t.Fatalf("unexpected profile: %+v", got)
	}
	all, err := ListProfiles(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Name != "Development" {
		t.Fatalf("unexpected profiles: %+v", all)
	}
}

func TestProfileUpsertOverwrites(t *testing.T) {
	d := mustOpen(t)
	first := Profile{ID: "dev", Name: "Development", ConcurrencyPerAgent: 2, ConcurrencyMachine: 4, Env: map[string]string{"LOG_LEVEL": "debug"}}
	if err := UpsertProfile(context.Background(), d, first); err != nil {
		t.Fatal(err)
	}
	second := Profile{ID: "dev", Name: "Prod", ConcurrencyPerAgent: 8, ConcurrencyMachine: 64, Env: map[string]string{"LOG_LEVEL": "info"}}
	if err := UpsertProfile(context.Background(), d, second); err != nil {
		t.Fatal(err)
	}
	got, err := GetProfile(context.Background(), d, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Name != "Prod" || got.ConcurrencyPerAgent != 8 || got.ConcurrencyMachine != 64 || got.Env["LOG_LEVEL"] != "info" {
		t.Fatalf("expected overwritten profile, got: %+v", got)
	}
	all, err := ListProfiles(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("expected exactly 1 profile after upsert-overwrite, got: %+v", all)
	}
}

func TestGetProfileNotFound(t *testing.T) {
	d := mustOpen(t)
	got, err := GetProfile(context.Background(), d, "missing")
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("expected nil profile, got: %+v", got)
	}
}

func TestUpsertProfileNilEnvNormalized(t *testing.T) {
	d := mustOpen(t)
	p := Profile{ID: "min", Name: "Minimal"}
	if err := UpsertProfile(context.Background(), d, p); err != nil {
		t.Fatal(err)
	}
	got, err := GetProfile(context.Background(), d, "min")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Env == nil {
		t.Fatalf("expected non-nil empty env, got: %+v", got)
	}
	if len(got.Env) != 0 {
		t.Fatalf("expected empty env map, got: %+v", got.Env)
	}
}

// mustTasksTable creates the main-owned `tasks` table (same shape migration v1
// creates — it already carries multica_task_id TEXT UNIQUE) for the L36
// id-mapping tests. The daemon's Open() only creates daemon-owned tables.
func mustTasksTable(t *testing.T, d *sql.DB) {
	t.Helper()
	if _, err := d.Exec(`CREATE TABLE tasks (
		id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
		payload_json TEXT NOT NULL, result_json TEXT, error_json TEXT,
		multica_task_id TEXT UNIQUE, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
	)`); err != nil {
		t.Fatal(err)
	}
}

func TestMapTaskIDsUpdatesRow(t *testing.T) {
	d := mustOpen(t)
	mustTasksTable(t, d)
	if _, err := d.Exec(`INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES ('local-1','a1','queued','{}','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	if err := MapTaskIDs(context.Background(), d, "local-1", "mt-1"); err != nil {
		t.Fatal(err)
	}
	got, err := MulticaTaskIDByLocal(context.Background(), d, "local-1")
	if err != nil {
		t.Fatal(err)
	}
	if got != "mt-1" {
		t.Fatalf("expected mt-1, got %q", got)
	}
}

func TestMapTaskIDsMissingLocalTaskErrors(t *testing.T) {
	d := mustOpen(t)
	mustTasksTable(t, d)
	err := MapTaskIDs(context.Background(), d, "nope", "mt-1")
	if err == nil {
		t.Fatal("expected error mapping a nonexistent local task")
	}
}

func TestMapTaskIDsEmptyMulticaIsNoop(t *testing.T) {
	d := mustOpen(t)
	mustTasksTable(t, d)
	if _, err := d.Exec(`INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES ('local-1','a1','queued','{}','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	if err := MapTaskIDs(context.Background(), d, "local-1", ""); err != nil {
		t.Fatal(err)
	}
	got, err := MulticaTaskIDByLocal(context.Background(), d, "local-1")
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("expected empty multica id, got %q", got)
	}
}

func TestMulticaTaskIDByLocalMissingReturnsEmpty(t *testing.T) {
	d := mustOpen(t)
	mustTasksTable(t, d)
	got, err := MulticaTaskIDByLocal(context.Background(), d, "nope")
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("expected empty multica id for missing row, got %q", got)
	}
}

func TestMulticaTaskIDByLocalNullColumn(t *testing.T) {
	d := mustOpen(t)
	mustTasksTable(t, d)
	if _, err := d.Exec(`INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES ('local-1','a1','queued','{}','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	got, err := MulticaTaskIDByLocal(context.Background(), d, "local-1")
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("expected empty multica id for NULL column, got %q", got)
	}
}
