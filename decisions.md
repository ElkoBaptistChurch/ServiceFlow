# ServiceFlow — Decision Log

Critical decisions taken while implementing
[the v1 plan](docs/superpowers/plans/2026-08-30-serviceflow-v1.md) against
[the design spec](docs/superpowers/specs/2026-08-30-serviceflow-design.md).

Only decisions that change how the app is built, tested or shipped are recorded here.
Routine implementation choices live in the code and its comments.

---

## D1 — Native module ABI: no `electron-rebuild` in `postinstall`

**Date:** 2026-08-30 · **Status:** Adopted · **Supersedes:** plan Task 1 Step 1

`better-sqlite3` is a native module, so it must be compiled against whichever Node ABI
will load it. Electron and plain Node use different ABIs, and this project needs both:
Electron loads it at runtime, and Vitest (plain Node) loads it in every database test.

The plan's `"postinstall": "electron-rebuild -f -w better-sqlite3"` compiles for Electron
on every `npm install`, which makes `npm test` fail with `NODE_MODULE_VERSION` mismatch —
including in Task 1's own "all four commands succeed" gate.

**Decision:** remove the `postinstall` hook. Two explicit scripts instead:

- `npm run rebuild:node` — build for plain Node. Needed before running tests if you have
  previously built for Electron. This is the state a fresh `npm install` leaves you in.
- `npm run rebuild:electron` — build for Electron. Run before `npm run dev`.

`electron-builder` rebuilds native dependencies for the packaging target itself, so
`npm run package` is unaffected either way.

**Cost if wrong:** running `npm run dev` without `rebuild:electron` first fails with a clear
ABI error rather than silently misbehaving.

---

## D2 — Development happens on a branch, not a separate worktree

**Date:** 2026-08-30 · **Status:** Adopted

Work is on `feat/serviceflow-v1` in the primary checkout rather than an isolated git
worktree. The church's real OpenLP files (`openlp/`, ~17 MB, git-ignored) live in this
checkout and Task 5's verification steps read them directly; an Electron `node_modules`
per worktree also costs roughly half a gigabyte. `main` is never committed to directly.

---

## D3 — Node.js 20 installed locally on the dev machine

**Date:** 2026-08-30 · **Status:** Adopted

The WSL machine had no Node.js (`apt` offers only Node 12, far below what Vite 5 /
Vitest 2 / Electron 32 need). Node v20.18.0 was installed to `~/.local/node` and symlinked
into `~/.local/bin`, which was already on `PATH`. Nothing outside the user's home directory
was touched, and no `sudo` was used. Remove `~/.local/node` and the three symlinks to revert.

---

## D4 — GUI and Windows-packaging steps are deferred to a real Windows session

**Date:** 2026-08-30 · **Status:** Adopted · **Confirms:** plan Global Constraints

Electron cannot open a window under this WSL environment (no WSLg/X server), and
`@electron/rebuild` cannot cross-compile `better-sqlite3` from Linux to Windows — so a
Linux-produced installer is untrustworthy even when the build exits zero.

Everything is therefore implemented, typechecked and covered by automated tests here, while
three checks are explicitly left for the church's Windows PC (or a `windows-latest` CI
runner): the app opening a window, the real-OBS Browser Source pass described in the spec's
testing strategy, and building the NSIS installer.
