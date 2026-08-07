# JARVIS functional tests

Versioned Electron + IPC regression suites. Directory names use **uppercase `V`** (e.g. `test/V1.0/`, `test/V1.1/`) — do not rename existing version folders.

## Run current release suite

From repo root (builds Electron main/preload on first run; rebuilds `better-sqlite3` for Electron):

```bash
pnpm test:functional
```

Requires Node ≥ 20.11, pnpm 9.12, and a one-time `pnpm install` at repo root. No real Provider API keys — suites use a local HTTPS mock OpenAI-compatible server.

## Isolation

Each spec uses a temp `JARVIS_DATA_DIR` under the OS temp directory. Wipe/backup tests only touch that isolated dir, never `~/.jarvis`.

## Add a new version

Copy `V1.0/` to `V1.1/`, update the coverage matrix in the new `README.md`, and point `test:functional` (or add `test:functional:V1.1`) at the new Playwright config.

## Layout

| Path | Purpose |
|------|---------|
| `test/README.md` | This index |
| `test/V1.0/README.md` | V1.0 coverage matrix + intentional skips |
| `test/V1.0/suites/*.spec.ts` | Playwright specs (serial, one worker) |
| `apps/desktop/e2e/` | Separate lightweight smoke suite (unchanged) |
