#!/usr/bin/env node
/**
 * JARVIS core headless entry (DAEM-01 / Decision A).
 *
 * Protocol (consumed by daemon/cmd/jarvis-agent NodeRunner):
 *   node headless.mjs --spec <path-to-RunSpec.json>
 *
 * Reads the Go RunSpec JSON, emits JSONL frames on stdout:
 *   {"type":"delta","delta":"..."}
 *   {"type":"result","status":"completed"|"failed","result"?:string,"error"?:string,"model"?:string}
 *
 * This file is the source of truth; `pnpm --dir packages/core build` copies it to
 * `dist/headless.mjs` so jarvis-agent can resolve an absolute JARVIS_CORE_ENTRY.
 *
 * Full AgentEngine REACT wiring (providers/tools) is loaded when available via
 * the optional headless-engine hook; otherwise the entry still honours the
 * JSONL contract so the Go→Node bridge fail-louds with a structured result.
 */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const out = { spec: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec' && argv[i + 1]) {
      out.spec = argv[++i];
    }
  }
  return out;
}

function emit(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function fail(error) {
  emit({ type: 'result', status: 'failed', error: String(error) });
  process.exitCode = 1;
}

async function tryEngine(spec) {
  // Optional hook: a sibling headless-engine.mjs may provide runHeadless(spec).
  // Keeps AgentEngine out of this thin entry so other agents can evolve the
  // engine without merge conflicts on this packaging bridge.
  const candidates = [
    resolve(import.meta.dirname, './headless-engine.mjs'),
    resolve(import.meta.dirname, '../src/headless-engine.mjs'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const mod = await import(pathToFileURL(p).href);
    if (typeof mod.runHeadless === 'function') {
      return mod.runHeadless(spec);
    }
  }
  return null;
}

async function main() {
  const { spec: specPath } = parseArgs(process.argv.slice(2));
  if (!specPath) {
    fail('usage: headless.mjs --spec <path>');
    return;
  }
  const abs = resolve(specPath);
  if (!existsSync(abs)) {
    fail(`spec not found: ${abs}`);
    return;
  }

  let spec;
  try {
    spec = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    fail(`invalid spec JSON: ${e instanceof Error ? e.message : e}`);
    return;
  }

  if (!spec || typeof spec !== 'object') {
    fail('spec must be a JSON object');
    return;
  }
  if (!spec.workspace || typeof spec.workspace !== 'string') {
    fail('spec.workspace is required');
    return;
  }

  emit({ type: 'delta', delta: '' });

  try {
    const engineResult = await tryEngine(spec);
    if (engineResult) {
      emit({
        type: 'result',
        status: engineResult.status ?? 'completed',
        result: engineResult.result ?? '',
        error: engineResult.error,
        model: engineResult.model ?? spec.model,
      });
      if (engineResult.status === 'failed') process.exitCode = 1;
      return;
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : e);
    return;
  }

  // Bridge-present fallback: no engine hook yet. Surface a structured failure
  // so Multica does not hang, while keeping the JSONL contract intact.
  const msgs = Array.isArray(spec.initialMessages) ? spec.initialMessages : [];
  const preview = msgs.map((m) => (m && m.content) || '').filter(Boolean).join('\n').slice(0, 200);
  fail(
    `JARVIS_HEADLESS_ENGINE_UNAVAILABLE: core headless entry is present but no headless-engine hook is wired` +
      (preview ? ` (messages preview: ${JSON.stringify(preview)})` : ''),
  );
}

main().catch((e) => fail(e instanceof Error ? e.message : e));
