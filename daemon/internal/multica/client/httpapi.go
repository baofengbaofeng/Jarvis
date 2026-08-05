package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// HTTPClientAPI implements ClientAPI against a Multica Server HTTP endpoint (§Wire)。
type HTTPClientAPI struct {
	BaseURL string
	HTTP    *http.Client
}

func (h *HTTPClientAPI) Register(ctx context.Context, req RegisterRequest) (RegisterResponse, error) {
	var out RegisterResponse
	err := h.do(ctx, http.MethodPost, "/clients/register", req, &out)
	return out, err
}

func (h *HTTPClientAPI) Heartbeat(ctx context.Context, id string, hb HeartbeatStatus) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/heartbeat", hb, nil)
}

func (h *HTTPClientAPI) Poll(ctx context.Context, id string) ([]ClaimedTask, error) {
	var out []ClaimedTask
	err := h.do(ctx, http.MethodGet, "/clients/"+id+"/tasks", nil, &out)
	return out, err
}

func (h *HTTPClientAPI) StreamProgress(ctx context.Context, id, taskID string, c runtime.StreamChunk) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/tasks/"+taskID+"/progress", c, nil)
}

func (h *HTTPClientAPI) SendResult(ctx context.Context, id, taskID string, r TaskResult) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/tasks/"+taskID+"/result", r, nil)
}

func (h *HTTPClientAPI) Ack(ctx context.Context, id, taskID string, ok bool) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/tasks/"+taskID+"/ack", map[string]bool{"accepted": ok}, nil)
}

func (h *HTTPClientAPI) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.BaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("multica %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("multica %s %s: status %d: %s", method, path, resp.StatusCode, truncate(string(b), 200))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
