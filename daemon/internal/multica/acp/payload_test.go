package acp

import "testing"

func TestParseTaskPayloadValid(t *testing.T) {
	data := []byte(`{"taskId":"t-1","multicaTaskId":"mt-9","instruction":"fix the bug","context":{"issue":"login broken"},"env":{"LOG":"1"}}`)
	p, err := ParseTaskPayload(data)
	if err != nil {
		t.Fatal(err)
	}
	if p.MulticaTaskID != "mt-9" || p.Instruction != "fix the bug" {
		t.Fatalf("unexpected: %+v", p)
	}
	if len(p.MCPServers) != 0 {
		t.Fatalf("no mcp expected: %+v", p.MCPServers)
	}
}

func TestParseTaskPayloadMissingTaskID(t *testing.T) {
	if _, err := ParseTaskPayload([]byte(`{"instruction":"x"}`)); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseTaskPayloadMissingInstruction(t *testing.T) {
	if _, err := ParseTaskPayload([]byte(`{"taskId":"t-1"}`)); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseTaskPayloadContextInstructionFallback(t *testing.T) {
	p, err := ParseTaskPayload([]byte(`{"taskId":"t-2","context":{"issue":"hi","instruction":"do it"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if p.Context == nil || p.Context.Instruction != "do it" {
		t.Fatalf("unexpected: %+v", p)
	}
}

func TestBuildInitialMessagesFromContext(t *testing.T) {
	p := &TaskPayload{
		TaskID:  "t-1",
		Context: &TaskContext{Issue: "login broken", Comments: []string{"repro: step1"}, Instruction: "please fix"},
	}
	msgs := BuildInitialMessages(p)
	if len(msgs) != 3 {
		t.Fatalf("want 3 messages, got %d", len(msgs))
	}
	if msgs[0].Content != "login broken" || msgs[2].Content != "please fix" {
		t.Fatalf("unexpected: %+v", msgs)
	}
}

func TestBuildInitialMessagesInstructionOnly(t *testing.T) {
	p := &TaskPayload{TaskID: "t-3", Instruction: "run tests"}
	msgs := BuildInitialMessages(p)
	if len(msgs) != 1 || msgs[0].Content != "run tests" {
		t.Fatalf("unexpected: %+v", msgs)
	}
}
