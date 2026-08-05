package runtime

import (
	"bufio"
	"bytes"
	"strings"
	"testing"
)

func TestStreamWriterJSONL(t *testing.T) {
	var buf bytes.Buffer
	sw := NewStreamWriter(&buf)
	if err := sw.Progress("t-1", "running", "fixing..."); err != nil {
		t.Fatal(err)
	}
	if err := sw.Result("t-1", "completed", "done", "claude-sonnet-4-6", ""); err != nil {
		t.Fatal(err)
	}

	sc := bufio.NewScanner(strings.NewReader(buf.String()))
	lines := []string{}
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d: %q", len(lines), buf.String())
	}
	if !strings.Contains(lines[0], `"type":"progress"`) {
		t.Fatalf("bad line0: %s", lines[0])
	}
	if !strings.Contains(lines[1], `"type":"result"`) {
		t.Fatalf("bad line1: %s", lines[1])
	}
}
