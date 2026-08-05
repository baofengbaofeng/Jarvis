package runtime

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// StreamChunk is one JSONL frame pushed to the consumer (H1.4).
type StreamChunk struct {
	Type   string `json:"type"` // "progress" | "result"
	TaskID string `json:"taskId"`
	Status string `json:"status"` // running | completed | failed
	Delta  string `json:"delta,omitempty"`
	Result string `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
	Model  string `json:"model,omitempty"`
	TS     int64  `json:"ts"`
}

// StreamWriter writes JSONL frames to w (jarvis-agent stdout / daemon→Server).
type StreamWriter struct {
	w   *bufio.Writer
	enc *json.Encoder
}

func NewStreamWriter(w io.Writer) *StreamWriter {
	bw := bufio.NewWriter(w)
	return &StreamWriter{w: bw, enc: json.NewEncoder(bw)}
}

func (s *StreamWriter) Progress(taskID, status, delta string) error {
	return s.emit(StreamChunk{Type: "progress", TaskID: taskID, Status: status, Delta: delta, TS: time.Now().Unix()})
}

func (s *StreamWriter) Result(taskID, status, result, model, errMsg string) error {
	return s.emit(StreamChunk{Type: "result", TaskID: taskID, Status: status, Result: result, Model: model, Error: errMsg, TS: time.Now().Unix()})
}

func (s *StreamWriter) emit(c StreamChunk) error {
	if err := s.enc.Encode(c); err != nil {
		return fmt.Errorf("stream emit: %w", err)
	}
	return s.w.Flush()
}
