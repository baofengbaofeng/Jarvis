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
