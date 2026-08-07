# JARVIS functional tests

Versioned Electron + IPC regression suites. Directory names match product semver (e.g. `test/1.0.0-Preview/`); do not rename existing version folders without updating root `test:functional`.

## Run current release suite

From repo root (builds Electron main/preload on first run; rebuilds `better-sqlite3` for Electron):

```bash
pnpm test:functional
```

Requires Node ≥ 20.11, pnpm 9.12, and a one-time `pnpm install` at repo root. No real Provider API keys — suites use a local HTTPS mock OpenAI-compatible server.

## Isolation

Each spec uses a temp `JARVIS_DATA_DIR` under the OS temp directory. Wipe/backup tests only touch that isolated dir, never `~/.jarvis`.

## Add a new version

Copy `1.0.0-Preview/` to a new semver folder (e.g. `1.1.0-Preview/`), update the coverage matrix in the new `README.md`, and point `test:functional` at the new Playwright config.

## Layout

| Path | Purpose |
|------|---------|
| `test/README.md` | This index |
| `test/1.0.0-Preview/README.md` | 1.0.0-Preview coverage matrix + intentional skips |
| `test/1.0.0-Preview/suites/*.spec.ts` | Playwright specs (serial, one worker) |
| `apps/desktop/e2e/` | Separate lightweight smoke suite (unchanged) |
