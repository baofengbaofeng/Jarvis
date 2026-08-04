# @jarvis/desktop

Electron shell for JARVIS. See the monorepo root README for the overall layout.

## better-sqlite3 dual-ABI note

`better-sqlite3` is a native module compiled against a specific Node/Electron ABI.
The single module in the pnpm store can only match **one ABI at a time**, but this
package runs under two different runtimes:

- Electron 32 → ABI 128
- System Node (vitest / `pnpm test`) → ABI 137

So the installed binary must be rebuilt when switching runtimes:

- Before launching the real Electron app (`pnpm dev` / `pnpm start` / packaged app):

  ```sh
  pnpm rebuild:electron   # electron-rebuild -f -w better-sqlite3
  ```

- Before running tests under system Node:

  ```sh
  pnpm rebuild:node       # npm rebuild better-sqlite3
  ```

**Do NOT run `rebuild:electron` and then run the vitest suite** — the native module
will fail to load under system Node (and vice versa).

## Go daemon binary

`DaemonSupervisor` spawns a compiled daemon binary at
`resources/daemon/jarvis-daemon` (ignored by git). Build it with:

```sh
pnpm build:daemon
```
