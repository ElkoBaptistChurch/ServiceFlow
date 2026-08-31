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

---

## D5 — Bible re-import upserts and never deletes

**Date:** 2026-08-30 · **Status:** Adopted · **Confirms:** spec "OpenLP import"

A review found that re-importing a Bible file removes nothing that was deleted upstream, while
re-importing songs replaces a song's blocks wholesale. That asymmetry is deliberate and stays.

The spec specifies exactly this: books are upserted by `(translation, source_book_id)` and verses by
`(book_id, chapter, verse)`, while only *song blocks* are replaced wholesale. Making the Bible side
delete rows absent from the source would also be actively dangerous with the church's actual files —
see D6: `New English Translation (NET).sqlite` holds 106 verses and
`New King James Version (NKJV).sqlite` holds 152. Re-importing one of those over a fuller library
would erase verses rather than heal anything.

**Known consequence:** a verse renumbered or corrected in OpenLP leaves its old row behind, still
reachable through content search, until the operator imports into a fresh database. Judged the
cheaper failure by a wide margin.

---

## D6 — The church's NET and NKJV files are partial, and acceptance criterion 3 is restated

**Date:** 2026-08-30 · **Status:** Adopted · **Amends:** spec acceptance criterion 3

Measured directly from the real files, twice, by two independent agents:

| File | Verses |
|---|---|
| `KJV.sqlite` | 36,503 |
| `New English Translation (NET).sqlite` | 106 |
| `New King James Version (NKJV).sqlite` | 152 |

NET and NKJV are partial sample databases, not full translations. NET's Romans begins at 7:1 and its
Acts at 2:1; NKJV's Romans book row contains no verses at all.

This is a **data fact, not a code defect** — all three import cleanly with zero skipped rows, and the
swapped-source-book-id handling is correct for all three. But it makes acceptance criterion 3
("spot-check Romans 1:1 and Acts 1:1 in KJV *and* NET") impossible to satisfy as written.

**Restated criterion:** KJV is content-verified at Romans 1:1 ("Paul, a servant…") and Acts 1:1
("The former treatise…"). NET and NKJV are verified structurally — correct book name against
`source_book_id`, with the swap direction confirmed — plus content-verified at each book's first
available verse (NET Acts 2:1, NET Romans 7:1), which does discriminate the two books from each
other. That is the strongest check these files support.

**Action for the church:** if full NET and NKJV libraries were expected, they need re-downloading in
OpenLP and re-importing. ServiceFlow will pick up the fuller files with no code change.

---

## D7 — Documented apocrypha fact corrected: 11 books, not 12

**Date:** 2026-08-30 · **Status:** Adopted · **Corrects:** spec + plan "Verified data facts"

Both documents state that KJV carries 12 apocryphal books at source ids 67-78 with
`testament_reference_id = 3`. The real file has 12 books in that id range, but only **11** carry
`testament_reference_id = 3` — id 69, "Esdras", is tagged `1` (and shares `book_reference_id` 15
with Ezra), so the importer correctly maps it to `OT` rather than `AP`.

All 12 books import. The code is right and the documented fact was wrong, so the documents are what
changed. Anyone later writing a test that asserts "12 books with `testament = 'AP'`" would be
encoding the error.

---

## D8 — ServiceFlow is single-instance

**Date:** 2026-08-31 · **Status:** Adopted · **Extends:** spec "Error handling"

Nothing in the spec or plan said what happens if the app is launched twice. It matters more than it
sounds: Electron takes a few seconds to show a window, so a volunteer who double-clicks the Start
Menu shortcut launches two instances as a matter of course.

Without a lock, the second instance opened the *same* database, failed to bind the preferred port,
fell back to a random one, and told the operator to re-point OBS at the new URL. Both windows then
wrote `live_state`, but each broadcast only to its own WebSocket clients — and OBS was connected to
the first. Reproduced against compiled output: the second window's banner read `LIVE: Psalms 23:1`
while the socket OBS held still showed `John 3:16`, indefinitely, with no self-heal.

That is exactly the banner-versus-output disagreement the design exists to prevent, so the app now
takes `app.requestSingleInstanceLock()` **before** opening the database or starting a server. A
losing instance quits immediately, touching nothing, and hands focus to the window already running.

---

## D9 — Startup failures must be a dialog, never a silent exit

**Date:** 2026-08-31 · **Status:** Adopted · **Confirms:** spec "Error handling"

The spec requires database write failures to surface visibly, on the reasoning that immediate
persistence is the crash-recovery mechanism and a silent failure is worse than a loud one. That
protection had a hole at the one moment it matters most: startup.

`app.whenReady().then(createWindow)` had no `.catch`, and `createWindow` is async, so a throw from
`openDatabase` — a corrupt database after a hard power-off, a read-only `userData` directory, or the
native-module ABI mismatch D1 describes — became an unhandled rejection and Node terminated the
process. The volunteer would double-click the icon and see nothing happen at all. The renderer's
error banner cannot help, because at that point there is no renderer.

Startup failures now show a native error dialog naming what failed, then quit.

---

## D10 — The remaining risk is concentrated in what Linux cannot test

**Date:** 2026-08-31 · **Status:** Open — action required on Windows

Automated coverage is 136 tests, and the whole-branch review walked all seven acceptance criteria.
Criteria 1, 2, 3, 6 and 7 pass against the church's real files; criterion 2 was verified far beyond
its spot-check — **all 556 songs** match their source `<verse>` counts exactly.

Criteria 4 and 5 are not verifiable here and are the honest remaining risk:

- **4 (a named verse on stream in under 5 seconds)** — no GUI to time it on. There is no latency
  obstacle in the code: a 150 ms debounce, then sub-millisecond book, chapter and verse lookups, and
  a 26 ms worst case for a single-letter full-text search across 36,000 verses. It needs a stopwatch.
- **5 (every verse fits the 1920×1080 frame)** — no browser to measure in. The mechanism is right
  (post-render measurement stepping 48 px down to a 24 px floor, under a `max-height: 60vh` ceiling).
  Esther 8:9 at 534 characters should fit comfortably. **KJV's apocryphal Sirach 1:0 is 3,133
  characters** and will hit the floor and be clipped by the ceiling rather than overflow the screen —
  graceful, but confirm it on the real source.

Both belong to the manual OBS pass the spec's testing strategy already requires before first live
use. See `README.md` for the full Windows checklist.
