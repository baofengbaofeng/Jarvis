package policy

import (
	"bytes"
	"strings"
	"testing"
)

func TestAuditOmitsEnvValuesAndRawArgs(t *testing.T) {
	var out bytes.Buffer
	a := NewJSONLAudit(&out)
	err := a.Write(InjectionAuditEntry{
		TaskID: "t1", Kind: "env", Name: "TOKEN", Result: "denied",
		Reason: "ENV_NOT_ALLOWED", Digest: "abc",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "super-secret") || strings.Contains(out.String(), "--password") {
		t.Fatalf("sensitive material in audit: %s", out.String())
	}
	line := out.String()
	for _, need := range []string{`"taskId":"t1"`, `"kind":"env"`, `"name":"TOKEN"`, `"result":"denied"`, `"reason":"ENV_NOT_ALLOWED"`} {
		if !strings.Contains(line, need) {
			t.Fatalf("missing %s in %s", need, line)
		}
	}
}
