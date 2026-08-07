import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskOrchestrator, type TaskStoreAdapter } from './TaskOrchestrator';
import { AgentEngine } from '../agent/AgentEngine';
import { ToolRegistry } from '../agent/ToolRegistry';
import { createFileTools } from '../tools/file';
import { createShellTool } from '../tools/shell';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import type { AgentConfig } from '@jarvis/protocol';

// S2 acceptance (MVP): an agent bound to a workspace issues write_file + run_shell
// tool calls; the orchestrator executes them against the REAL file/shell tools
// under a readwrite sandbox rooted at the workspace, and the task completes.
const agent: AgentConfig = { id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: '', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

describe('S2 toolchain integration (write_file + run_shell)', () => {
  it('writes a file into the workspace and lists it via run_shell', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-s2-'));
    try {
      const target = join(ws, 'hello.txt');

      const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['ls'] };
      const reg = new ToolRegistry();
      createFileTools(reg, policy);
      createShellTool(reg, policy);

      let chatCalls = 0;
      let shellOutput = '';
      const engine = new AgentEngine({
        modelRouter: {
          chat: async (_req, o) => {
            chatCalls++;
            if (chatCalls === 1) {
              // First turn: the model requests write_file then run_shell.
              o.onChunk?.({
                kind: 'tool_call',
                toolCalls: [
                  { id: 't1', name: 'write_file', arguments: { path: target, content: 'hello jarvis' } },
                  { id: 't2', name: 'run_shell', arguments: { command: 'ls' } }
                ]
              });
              return { text: '', usage: null };
            }
            // Second turn: the model summarises and finishes.
            o.onChunk?.({ kind: 'delta', delta: 'done' });
            o.onChunk?.({ kind: 'done' });
            return { text: 'done', usage: null };
          }
        },
        toolRegistry: reg
      });

      const states: string[] = [];
      const store: TaskStoreAdapter = {
        async create() {},
        async updateState(_id, state) { states.push(state); },
        async appendLog() {}
      };

      let doneOk = false;
      const done = new Promise<void>((resolve) => {
        const orb = new TaskOrchestrator(engine, store, {
          onTool: (_id, call, result) => { if (call.name === 'run_shell') shellOutput = result.output; },
          onDone: (_id, ok) => { doneOk = ok; resolve(); }
        }, 1);
        orb.submit({
          id: 's2-1',
          agent,
          messages: [{ role: 'user', content: 'create a file and list the workspace' }],
          cwd: ws,
          env: {},
          apiKey: 'sk-test',
          provider: { type: 'openai-compatible', baseUrl: 'https://api.openai.com' },
          modelId: 'm1',
          workspaceRoot: ws
        });
      });
      await done;

      // The write_file tool actually wrote into the temp workspace.
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('hello jarvis');
      // The run_shell tool output surfaces the written filename.
      expect(shellOutput).toContain('hello.txt');
      // The task reached the completed state.
      expect(doneOk).toBe(true);
      expect(states).toContain('completed');
    } finally {
      // J2 (M3 final review): clean up the temp workspace so the test leaves
      // no residue in the OS temp dir.
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
