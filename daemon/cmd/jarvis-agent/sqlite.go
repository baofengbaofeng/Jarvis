package main

import (
	"context"
	"database/sql"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// sqliteModelLister reads the main-owned models table for --list-models (H1.9).
type sqliteModelLister struct{ d *sql.DB }

func (s sqliteModelLister) ListModels(ctx context.Context) ([]db.ModelInfo, error) {
	return db.ListModels(ctx, s.d)
}

type sqliteHistoryLoader struct{ d *sql.DB }

func (s *sqliteHistoryLoader) Load(ctx context.Context, conversationID string) ([]acp.InitialMessage, error) {
	rows, err := s.d.QueryContext(ctx,
		`SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []acp.InitialMessage
	for rows.Next() {
		var m acp.InitialMessage
		if err := rows.Scan(&m.Role, &m.Content); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type sqliteTaskRecorder struct{ d *sql.DB }

// Record persists the L36 mapping for a Multica-claimed task. §13.3 makes the
// M7+ Multica path daemon-written, so the recorder first ensures the local
// `tasks` row exists (INSERT OR IGNORE) before MapTaskIDs' UPDATE (C1: nothing
// else creates the row for a claim).
func (s *sqliteTaskRecorder) Record(ctx context.Context, local, multica, payloadJSON string) error {
	if err := db.EnsureTaskRow(ctx, s.d, local, "jarvis", payloadJSON); err != nil {
		return err
	}
	return db.MapTaskIDs(ctx, s.d, local, multica)
}

type sqliteProfileStore struct{ d *sql.DB }

func (s *sqliteProfileStore) Get(ctx context.Context, id string) (*db.Profile, error) {
	return db.GetProfile(ctx, s.d, id)
}
