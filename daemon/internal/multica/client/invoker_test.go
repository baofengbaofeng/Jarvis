package client

import (
	"strings"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func TestParseClaimFramesLargeResult(t *testing.T) {
	big := strings.Repeat("x", 70*1024) // >64KB default bufio.Scanner token cap
	input := `{"type":"progress","taskId":"t1","status":"running","ts":1}` + "\n" +
		`{"type":"result","taskId":"t1","status":"completed","result":"` + big + `","model":"m1","ts":2}` + "\n"
	var got []runtime.StreamChunk
	res, err := parseClaimFrames(strings.NewReader(input), func(c runtime.StreamChunk) {
		got = append(got, c)
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" || res.Result != big {
		t.Fatalf("large result not preserved: status=%q len(result)=%d", res.Status, len(res.Result))
	}
	if len(got) != 1 || got[0].Status != "running" {
		t.Fatalf("expected 1 progress frame, got %d", len(got))
	}
}

func TestParseClaimFramesDeltaOnlyFails(t *testing.T) {
	input := `{"type":"progress","taskId":"t1","status":"running","delta":"working","ts":1}` + "\n"
	res, err := parseClaimFrames(strings.NewReader(input), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "failed" || res.Error == "" {
		t.Fatalf("expected failed default, got %+v", res)
	}
}

func TestParseClaimFramesSkipsNoise(t *testing.T) {
	input := "not json at all\n" +
		`{"type":"result","taskId":"t1","status":"completed","result":"ok","ts":2}` + "\n"
	res, err := parseClaimFrames(strings.NewReader(input), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" || res.Result != "ok" {
		t.Fatalf("noise line corrupted parse: %+v", res)
	}
}
