package client

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// ClientAPI abstracts the Multica Server wire calls (§Wire) for testability.
type ClientAPI interface {
	Register(ctx context.Context, req RegisterRequest) (RegisterResponse, error)
	Heartbeat(ctx context.Context, clientID string, status HeartbeatStatus) error
	Poll(ctx context.Context, clientID string) ([]ClaimedTask, error)
	StreamProgress(ctx context.Context, clientID, taskID string, chunk runtime.StreamChunk) error
	SendResult(ctx context.Context, clientID, taskID string, res TaskResult) error
	Ack(ctx context.Context, clientID, taskID string, ok bool) error
}

type RegisterRequest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Protocol    string   `json:"protocol"` // "acp"
	Version     string   `json:"version"`
	Concurrency int      `json:"concurrency"`
	Models      []string `json:"models,omitempty"` // H1.9
}

type RegisterResponse struct {
	ClientID     string `json:"clientId"`
	HeartbeatSec int    `json:"heartbeatInterval"`
	PollSec      int    `json:"pollInterval"`
}

type HeartbeatStatus struct {
	Status      string `json:"status"` // "idle" | "busy"
	ActiveTasks int    `json:"activeTasks"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type ClaimedTask struct {
	TaskID        string          `json:"taskId"`
	MulticaTaskID string          `json:"multicaTaskId"`
	Payload       json.RawMessage `json:"payload"`
}

type TaskResult struct {
	Status     string `json:"status"` // completed | failed
	Result     string `json:"result,omitempty"`
	Error      string `json:"error,omitempty"`
	Model      string `json:"model,omitempty"`
	FinishedAt int64  `json:"finishedAt"`
}

// Client drives the ACP registration/heartbeat/poll cycle (H1.10). mu guards
// registration so RegisteredID() is safe to read from task-execution goroutines
// while Serve re-registers (I3).
type Client struct {
	mu           sync.Mutex
	api          ClientAPI
	heartbeatSec time.Duration
	pollSec      time.Duration
	reconnectSec time.Duration
	name         string
	version      string
	concurrency  int
	models       []string
	registration RegisterResponse
}

type ClientOptions struct {
	Name         string
	Version      string
	Concurrency  int
	Models       []string
	HeartbeatSec time.Duration
	PollSec      time.Duration
	ReconnectSec time.Duration
}

func NewClient(api ClientAPI, opts ClientOptions) *Client {
	if opts.HeartbeatSec == 0 {
		opts.HeartbeatSec = 15 * time.Second
	}
	if opts.PollSec == 0 {
		opts.PollSec = 3 * time.Second
	}
	if opts.ReconnectSec == 0 {
		opts.ReconnectSec = 2 * time.Second
	}
	return &Client{
		api: api, heartbeatSec: opts.HeartbeatSec, pollSec: opts.PollSec, reconnectSec: opts.ReconnectSec,
		name: opts.Name, version: opts.Version, concurrency: opts.Concurrency, models: opts.Models,
	}
}

// Register performs H1.10 registration/discovery; returns the client id.
func (c *Client) Register(ctx context.Context) (string, error) {
	req := RegisterRequest{
		ID: c.name, Name: c.name, Protocol: "acp", Version: c.version,
		Concurrency: c.concurrency, Models: c.models,
	}
	res, err := c.api.Register(ctx, req)
	if err != nil {
		return "", fmt.Errorf("multica register: %w", err)
	}
	c.mu.Lock()
	c.registration = res
	c.mu.Unlock()
	return res.ClientID, nil
}

// RegisteredID returns the server-assigned client id from the last successful
// Register (I3); empty before registration or after a registration failure.
func (c *Client) RegisteredID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.registration.ClientID
}

// Poll sends a heartbeat then fetches pending tasks (deterministic step).
func (c *Client) Poll(ctx context.Context, hb HeartbeatStatus) ([]ClaimedTask, error) {
	id := c.RegisteredID()
	if id == "" {
		return nil, fmt.Errorf("not registered")
	}
	if err := c.api.Heartbeat(ctx, id, hb); err != nil {
		return nil, err
	}
	return c.api.Poll(ctx, id)
}

// RunOnce performs one register + poll cycle (deterministic, for tests).
func (c *Client) RunOnce(ctx context.Context, hb HeartbeatStatus) ([]ClaimedTask, error) {
	if _, err := c.Register(ctx); err != nil {
		return nil, err
	}
	return c.Poll(ctx, hb)
}

// Serve runs register + heartbeat + poll until ctx is done (H1.10), wrapping
// serveOnce in a re-register loop with backoff (I1): a transient heartbeat/poll
// error no longer permanently kills the client goroutine — it re-registers after
// reconnectSec. The loop returns only on ctx cancellation.
func (c *Client) Serve(ctx context.Context, status func() HeartbeatStatus, onTasks func([]ClaimedTask)) error {
	for {
		err := c.serveOnce(ctx, status, onTasks)
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			log.Printf("multica client serve: %v; re-registering in %s", err, c.reconnectSec)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(c.reconnectSec):
		}
	}
}

// serveOnce is one register + heartbeat/poll cycle; returns on ctx cancellation
// (nil) or on the first heartbeat/poll/register error.
func (c *Client) serveOnce(ctx context.Context, status func() HeartbeatStatus, onTasks func([]ClaimedTask)) error {
	if _, err := c.Register(ctx); err != nil {
		return err
	}
	hb := time.NewTicker(c.heartbeatSec)
	poll := time.NewTicker(c.pollSec)
	defer hb.Stop()
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-hb.C:
			if err := c.api.Heartbeat(ctx, c.registration.ClientID, status()); err != nil {
				return err
			}
		case <-poll.C:
			tasks, err := c.api.Poll(ctx, c.registration.ClientID)
			if err != nil {
				return err
			}
			if onTasks != nil && len(tasks) > 0 {
				onTasks(tasks)
			}
		}
	}
}
