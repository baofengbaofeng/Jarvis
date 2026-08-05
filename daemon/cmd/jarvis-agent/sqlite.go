package main

import (
	"context"
	"database/sql"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
)

// sqliteModelLister reads the main-owned models table for --list-models (H1.9).
type sqliteModelLister struct{ d *sql.DB }

func (s sqliteModelLister) ListModels(ctx context.Context) ([]db.ModelInfo, error) {
	return db.ListModels(ctx, s.d)
}
