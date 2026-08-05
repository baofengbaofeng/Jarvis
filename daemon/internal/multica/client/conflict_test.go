package client

import (
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

func TestConflictStoreAddAndResolve(t *testing.T) {
	cs := NewConflictStore()
	cs.Add(ConflictItem{TaskID: "t1", Skill: &acp.SkillConflict{Name: "review", LocalPath: "/l", MulticaPath: "/m"}})
	if len(cs.Conflicts()) != 1 {
		t.Fatalf("want 1 conflict, got %d", len(cs.Conflicts()))
	}
	if !cs.Resolve("review", "local") {
		t.Fatal("expected resolve true")
	}
	if cs.Resolve("review", "local") {
		t.Fatal("expected second resolve false")
	}
	if !cs.Conflicts()[0].Resolved {
		t.Fatalf("conflict not marked resolved: %+v", cs.Conflicts()[0])
	}
}
