# Model capabilities (max output / tools / images) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-model max output tokens + tools/images flags (Zed-like), edit them in Provider model UI (layout A), and enforce them when assembling chat/Agent requests.

**Architecture:** Extend `Model` / SQLite / IPC; add a pure `gateModelCapabilities` helper in `packages/core`; apply it in `AgentEngine` and chat IPC before provider calls. UI extends the existing two-row draft form + list chips/edit (mockup A). Soft notices use stable codes (`MODEL_TOOLS_UNSUPPORTED`) localized at the UI/main boundary.

**Tech Stack:** TypeScript, better-sqlite3 migrations, Electron IPC, React settings UI, vitest, react-i18next

**Spec:** `docs/superpowers/specs/2026-08-09-model-capabilities-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/index.ts` | `Model` / `SelectableModel` fields; optional `PROVIDER_FIELD_MAX.maxOutputTokens` reuse of `contextTokens` ceiling |
| `apps/desktop/src/main/db/migrations.ts` | v18 columns |
| `apps/desktop/src/main/ipc/providers.ts` | read/write/updateModel validation |
| `apps/desktop/src/main/ipc/IpcRouter.ts` + `packages/protocol/src/ipc-allowlist.ts` | `provider.updateModel` |
| `packages/core/src/model/capabilities.ts` (+ `.spec.ts`) | Pure gate |
| `packages/core/src/agent/AgentEngine.ts` | Apply gate per step |
| `apps/desktop/src/main/ipc/chat.ts` | Image hard-fail + maxTokens |
| `apps/desktop/src/main/ipc/task-squad-bridge.ts` / task run path | Pass capabilities into `engine.run` |
| `apps/desktop/src/main/ipc/config.ts` | Export new model columns |
| `apps/desktop/src/renderer/.../ProviderSettingsPage.tsx` (+ spec) | Layout A UI |
| `packages/i18n/locales/{zh-CN,en}/common.json` | Labels + errors + soft notice |

---

### Task 1: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/index.spec.ts` (only if new helpers/limits are asserted)

- [ ] **Step 1: Extend types**

On `Model` and `SelectableModel` add:

```ts
/** Max completion tokens; null/undefined = omit max_tokens on request. */
maxOutputTokens?: number | null;
/** Default true when omitted (legacy rows / safe default). */
supportsTools?: boolean;
/** Default false when omitted (legacy / safe default). */
supportsImages?: boolean;
```

Keep `PROVIDER_FIELD_MAX.contextTokens` as the shared upper bound for `maxOutputTokens` (no new constant required unless tests already enumerate every key).

- [ ] **Step 2: Typecheck protocol package**

Run: `cd packages/protocol && pnpm typecheck`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/index.spec.ts
git commit -m "$(cat <<'EOF'
feat: add model capability fields to protocol types

EOF
)"
```

---

### Task 2: SQLite migration v18

**Files:**
- Modify: `apps/desktop/src/main/db/migrations.ts`

- [ ] **Step 1: Append migration**

After v17, add:

```ts
{
  version: 18,
  sql: `
  ALTER TABLE models ADD COLUMN max_output_tokens INTEGER;
  ALTER TABLE models ADD COLUMN supports_tools INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE models ADD COLUMN supports_images INTEGER NOT NULL DEFAULT 0;
  `,
},
```

Do not edit prior migrations. If another migration already claimed 18, use the next free version and update this plan’s references.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/db/migrations.ts
git commit -m "$(cat <<'EOF'
feat: migrate models max output and capability flags

EOF
)"
```

---

### Task 3: Provider store + IPC (TDD)

**Files:**
- Modify: `apps/desktop/src/main/ipc/providers.ts`
- Modify: `apps/desktop/src/main/ipc/providers.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `apps/desktop/src/main/ipc/config.ts` (export SELECT)

- [ ] **Step 1: Write failing store tests**

In `providers.spec.ts`, cover:

1. `addModel` persists `maxOutputTokens`, `supportsTools`, `supportsImages` (defaults: null / true / false when omitted).
2. Invalid `maxOutputTokens` (0, negative, non-integer, > `PROVIDER_FIELD_MAX.contextTokens`) → `PROVIDER_MODEL_MAX_OUTPUT_INVALID`.
3. `updateModel(id, patch)` updates name/context/max/flags; rejects unknown id; does **not** change `modelId`.
4. `listSelectableModels` returns the three new fields.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/providers.spec.ts`  
Expected: FAIL (missing columns/API)

- [ ] **Step 3: Implement store**

Extend `ModelInput`:

```ts
export interface ModelInput {
  modelId: string;
  name: string;
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsImages?: boolean;
}

export type ModelUpdateInput = {
  name?: string;
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsImages?: boolean;
};
```

Helpers (private):

```ts
function normalizeMaxOutput(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > PROVIDER_FIELD_MAX.contextTokens) {
    throw new Error('PROVIDER_MODEL_MAX_OUTPUT_INVALID');
  }
  return value;
}
```

- `rowToModel`: map `max_output_tokens`, `supports_tools` (default 1), `supports_images` (default 0).
- `addModel`: INSERT includes new columns; defaults `supportsTools=true`, `supportsImages=false` when omitted.
- `updateModel(id, patch)`: UPDATE name/context/max/flags only; return updated `Model`.
- `listSelectableModels`: SELECT + map new columns.

- [ ] **Step 4: Wire IPC**

Allowlist + `IpcRouter`:

```ts
this.register('provider.updateModel', (_e, id, input) => {
  try {
    const model = providers.updateModel(id as string, input as ModelUpdateInput);
    return { ok: true as const, model };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});
```

Export: widen models SELECT to include `context_tokens`, `enabled`, `max_output_tokens`, `supports_tools`, `supports_images` (import still out of scope).

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/providers.spec.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc/providers.ts apps/desktop/src/main/ipc/providers.spec.ts \
  apps/desktop/src/main/ipc/IpcRouter.ts packages/protocol/src/ipc-allowlist.ts \
  apps/desktop/src/main/ipc/config.ts
git commit -m "$(cat <<'EOF'
feat: persist and update model capability fields

EOF
)"
```

---

### Task 4: Pure capability gate (TDD)

**Files:**
- Create: `packages/core/src/model/capabilities.ts`
- Create: `packages/core/src/model/capabilities.spec.ts`
- Modify: `packages/core/src/index.ts` (export)
- Optionally modify: `packages/core/src/office/content.ts` — add `contentHasImages(content: unknown): boolean` if not already present; export via `renderer.ts` only if UI needs it (chat main can import from full core).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { gateModelCapabilities } from './capabilities';

describe('gateModelCapabilities', () => {
  it('applies maxOutputTokens when explicit maxTokens absent', () => {
    const r = gateModelCapabilities({
      capabilities: { maxOutputTokens: 2048, supportsTools: true, supportsImages: false },
      hasToolsAvailable: false,
      hasImages: false,
    });
    expect(r.maxTokens).toBe(2048);
    expect(r.error).toBeUndefined();
  });

  it('keeps explicit maxTokens over model default', () => {
    const r = gateModelCapabilities({
      capabilities: { maxOutputTokens: 2048, supportsTools: true, supportsImages: false },
      explicitMaxTokens: 1,
      hasToolsAvailable: false,
      hasImages: false,
    });
    expect(r.maxTokens).toBe(1);
  });

  it('omits maxTokens when model unset and no explicit', () => {
    const r = gateModelCapabilities({
      capabilities: { maxOutputTokens: null, supportsTools: true, supportsImages: false },
      hasToolsAvailable: false,
      hasImages: false,
    });
    expect(r.maxTokens).toBeUndefined();
  });

  it('strips tools and notices when unsupported', () => {
    const r = gateModelCapabilities({
      capabilities: { supportsTools: false, supportsImages: false },
      hasToolsAvailable: true,
      hasImages: false,
    });
    expect(r.includeTools).toBe(false);
    expect(r.notice).toBe('MODEL_TOOLS_UNSUPPORTED');
  });

  it('hard-fails on images when unsupported', () => {
    const r = gateModelCapabilities({
      capabilities: { supportsTools: true, supportsImages: false },
      hasToolsAvailable: false,
      hasImages: true,
    });
    expect(r.error).toBe('MODEL_IMAGES_UNSUPPORTED');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/core && pnpm vitest run src/model/capabilities.spec.ts`  
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
export type ModelCapabilityFields = {
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsImages?: boolean;
};

export type ModelCapabilityGateInput = {
  capabilities: ModelCapabilityFields;
  explicitMaxTokens?: number;
  hasToolsAvailable: boolean;
  hasImages: boolean;
};

export type ModelCapabilityGateResult = {
  maxTokens?: number;
  includeTools: boolean;
  notice?: 'MODEL_TOOLS_UNSUPPORTED';
  error?: 'MODEL_IMAGES_UNSUPPORTED';
};

export function resolveModelCapabilities(raw?: ModelCapabilityFields | null): Required<ModelCapabilityFields> {
  return {
    maxOutputTokens: raw?.maxOutputTokens ?? null,
    supportsTools: raw?.supportsTools !== false,
    supportsImages: raw?.supportsImages === true,
  };
}

export function gateModelCapabilities(input: ModelCapabilityGateInput): ModelCapabilityGateResult {
  const caps = resolveModelCapabilities(input.capabilities);
  if (input.hasImages && !caps.supportsImages) {
    return { includeTools: false, error: 'MODEL_IMAGES_UNSUPPORTED' };
  }
  const includeTools = caps.supportsTools && input.hasToolsAvailable;
  const notice =
    input.hasToolsAvailable && !caps.supportsTools ? 'MODEL_TOOLS_UNSUPPORTED' as const : undefined;
  let maxTokens: number | undefined;
  if (input.explicitMaxTokens != null) maxTokens = input.explicitMaxTokens;
  else if (caps.maxOutputTokens != null) maxTokens = caps.maxOutputTokens;
  return { maxTokens, includeTools, notice };
}
```

Add `contentHasImages` in `office/content.ts` (scan string = false; array parts for `image_url`).

Export `gateModelCapabilities` / `resolveModelCapabilities` / `contentHasImages` from `packages/core/src/index.ts`. Export `contentHasImages` from `renderer.ts` only if renderer gates client-side (optional; main-side gate is required).

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/core && pnpm vitest run src/model/capabilities.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model/capabilities.ts packages/core/src/model/capabilities.spec.ts \
  packages/core/src/office/content.ts packages/core/src/index.ts packages/core/src/renderer.ts
git commit -m "$(cat <<'EOF'
feat: add pure model capability gate

EOF
)"
```

---

### Task 5: AgentEngine + chat/task wiring (TDD)

**Files:**
- Modify: `packages/core/src/agent/AgentEngine.ts`
- Modify: `packages/core/src/agent/AgentEngine.spec.ts`
- Modify: `apps/desktop/src/main/ipc/chat.ts`
- Modify: `apps/desktop/src/main/ipc/chat.spec.ts`
- Modify: task run path that calls `engine.run` (find call sites via `engine.run(` — pass `modelCapabilities` loaded from the bound model row)

- [ ] **Step 1: Failing AgentEngine tests**

1. When `modelCapabilities.supportsTools === false` and registry has tools → request has no `tools`; result includes notice code `MODEL_TOOLS_UNSUPPORTED` (extend `TaskResult` or use `onNotice` callback — prefer `onNotice?: (code: string) => void` on `EngineRunInput` to avoid widening TaskResult unless already flexible).
2. When `supportsImages === false` and user message content has images → `run` throws `MODEL_IMAGES_UNSUPPORTED`.
3. When `maxOutputTokens` set and `cfg.maxTokens` unset → request `maxTokens` equals model value; when `cfg.maxTokens` set → cfg wins.

- [ ] **Step 2: Implement AgentEngine**

Add to `EngineRunInput`:

```ts
modelCapabilities?: ModelCapabilityFields;
onNotice?: (code: 'MODEL_TOOLS_UNSUPPORTED') => void;
```

Before building `ChatRequest` each step:

```ts
const hasToolsAvailable = visible.length > 0;
const hasImages = working.some((m) => contentHasImages(m.content));
const gate = gateModelCapabilities({
  capabilities: input.modelCapabilities ?? {},
  explicitMaxTokens: this.cfg.maxTokens,
  hasToolsAvailable,
  hasImages,
});
if (gate.error) throw new Error(gate.error);
if (gate.notice) input.onNotice?.(gate.notice);
const req: ChatRequest = {
  // ...
  maxTokens: gate.maxTokens,
  ...(gate.includeTools ? { tools: visible, toolChoice: 'auto' as const } : {}),
};
```

Call `onNotice` at most once per `run` (track a local boolean).

- [ ] **Step 3: Chat IPC**

In `chat.send` binding SELECT, also load `m.max_output_tokens`, `m.supports_tools`, `m.supports_images`.

Before `router.chat`:

```ts
const gate = gateModelCapabilities({
  capabilities: {
    maxOutputTokens: (binding.max_output_tokens as number | null) ?? null,
    supportsTools: Number(binding.supports_tools ?? 1) === 1,
    supportsImages: Number(binding.supports_images ?? 0) === 1,
  },
  hasToolsAvailable: false, // plain chat has no tool injection today
  hasImages: contentHasImages(content) || history.some(/* assistant/user contents */),
});
if (gate.error) {
  getWindow()?.webContents.send(IpcEvent.chatDone, { sessionId, error: gate.error });
  return { ok: false, error: gate.error };
}
// pass maxTokens: gate.maxTokens on ChatRequest
```

Map `MODEL_IMAGES_UNSUPPORTED` to i18n in renderer when displaying `chatDone.error` (or translate in main if chat already localizes — follow existing disabled-provider error pattern).

- [ ] **Step 4: Task path**

Where `engine.run` is invoked, load the agent’s model row capabilities and pass `modelCapabilities`. Wire `onNotice` to append audit-friendly UI: e.g. send a task/chat notice event or append a short assistant/system line using i18n key `settings.provider.notices.toolsUnsupported` (exact channel: match existing task progress/notice patterns; if none, `onDelta` a single localized line from main is acceptable).

- [ ] **Step 5: Run tests**

```bash
cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts src/model/capabilities.spec.ts
cd apps/desktop && pnpm vitest run src/main/ipc/chat.spec.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/AgentEngine.ts packages/core/src/agent/AgentEngine.spec.ts \
  apps/desktop/src/main/ipc/chat.ts apps/desktop/src/main/ipc/chat.spec.ts \
  # plus task bridge files touched
git commit -m "$(cat <<'EOF'
feat: enforce model capabilities in chat and agent engine

EOF
)"
```

---

### Task 6: Settings UI layout A + i18n (TDD)

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx`
- Modify: colocated `ProviderSettingsPage.spec.tsx` (create/extend)
- Modify: `packages/i18n/locales/en/common.json`
- Modify: `packages/i18n/locales/zh-CN/common.json`

- [ ] **Step 1: i18n keys (both locales)**

Under `settings.provider`:

```json
"modelMaxOutput": "Max output tokens",
"modelMaxOutputPlaceholder": "Empty = unlimited / provider default",
"modelSupportsTools": "Supports tools",
"modelSupportsImages": "Supports images",
"modelCapabilities": "Capabilities",
"editModel": "Edit model",
"cancelEditModel": "Cancel",
"capTools": "Tools",
"capImages": "Images",
"editingModel": "Editing {{modelId}} (Model ID is read-only)",
"errors": {
  "modelMaxOutputInvalid": "Max output tokens must be a positive integer"
},
"notices": {
  "toolsUnsupported": "This model is configured without tool support; continuing without tools."
}
```

zh-CN symmetric. Also map runtime errors:

- `chat.errors.modelImagesUnsupported` / `settings.provider.errors.modelImagesUnsupported` (pick one namespace; use consistently in chat error display)

- [ ] **Step 2: Failing UI tests**

- New draft defaults: tools on, images off, max output empty.
- Save calls `provider.addModel` with the three fields.
- Click edit → form prefills; Model ID read-only; save calls `provider.updateModel`.
- List shows capability chips (tools on / images off for a fixture row).

- [ ] **Step 3: Implement Layout A**

Extend `ModelDraft`:

```ts
type ModelDraft = {
  key: string;
  modelId: string;
  name: string;
  contextValue: string;
  contextUnit: ContextTokenUnit;
  maxOutputValue: string; // digits only; empty = null
  supportsTools: boolean;
  supportsImages: boolean;
  editingId?: string; // set when editing existing row
};
```

UI:

- Table columns: existing + **Capabilities** (chips) + enable + actions (**edit** + delete).
- Draft area: row1 = Model ID / name / context; row2 = max output / tools toggle / images toggle / Save (+ Cancel when editing).
- Editing banner using `editingModel`.
- Parse `maxOutputValue` like context digits (integer tokens, not K/M unless product later asks).

- [ ] **Step 4: Run UI tests + i18n check**

```bash
cd apps/desktop && pnpm vitest run src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx
pnpm i18n:check
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx \
  apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx \
  packages/i18n/locales/en/common.json packages/i18n/locales/zh-CN/common.json
git commit -m "$(cat <<'EOF'
feat: model capability fields in provider settings UI

EOF
)"
```

---

### Task 7: Verification sweep

- [ ] **Step 1: Targeted tests**

```bash
cd packages/core && pnpm vitest run src/model/capabilities.spec.ts src/agent/AgentEngine.spec.ts
cd apps/desktop && pnpm vitest run src/main/ipc/providers.spec.ts src/main/ipc/chat.spec.ts \
  src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx
pnpm i18n:check
```

Expected: all PASS

- [ ] **Step 2: Manual smoke (optional but recommended)**

1. Add model with tools on / images off / max 1024 → list chips match.
2. Edit images on → save → selectable list reflects.
3. Chat with image attachment on images-off model → clear error.
4. Agent/task with tools-off model → soft notice, reply without tools.

- [ ] **Step 3: Final commit only if sweep fixed stragglers; otherwise done**

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| DB columns + defaults | 2, 3 |
| Protocol / SelectableModel | 1, 3 |
| updateModel + addModel | 3 |
| Layout A UI + edit + chips | 6 |
| maxTokens apply/omit + explicit wins | 4, 5 |
| Tools soft notice + no tools | 4, 5 |
| Images hard fail | 4, 5 |
| Export fields | 3 |
| i18n symmetric | 6 |
| Non-goals (no autodetection / no adapter fork) | respected |

## Self-review notes

- No TBD placeholders left for required behavior; task-path notice wiring says “match existing patterns” with a concrete fallback (`onDelta` localized line).
- Gate types use stable codes consumed by i18n in Task 6.
- Migration version locked to **v18** based on current tip v17.
