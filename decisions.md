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
[37m
[0m[3m[32m## D11 — The preload is bundled, and renderer assets are relative
[0m[37m
[0m[1m[30m**[0m[1m[32mDate[0m:[1m[30m**[0m[37m [0m[1m[30m2026[0m[1m[30m-[0m[1m[30m08[0m[1m[30m-[0m[1m[30m31[0m[37m [0m·[37m [0m[1m[30m**[0mStatus:[1m[30m**[0m[37m [0mClosed[37m [0m—[37m [0mfixed,[37m [0mpending[37m [0mconfirmation[37m [0m[1m[1m[35mon[0m[37m [0mWindows[37m

[0mD10[37m [0mpredicted[37m [0mthe[37m [0mresidual[37m [0mrisk[37m [0msat[37m [0m[1m[1m[35min[0m[37m [0mwhat[37m [0mLinux[37m [0mcannot[37m [0mexercise.[37m [0mThe[37m [0mfirst[37m [0mCI[1m[30m-[0mbuilt[37m [0minstaller[37m
[0mduly[37m [0mfailed[37m [0m[1m[1m[35mon[0m[37m [0mlaunch,[37m [0m[1m[1m[35min[0m[37m [0mtwo[37m [0mways[37m [0mthat[37m [0mare[37m [0minvisible[37m [0m[1m[1m[35mto[0m[37m [0mthe[37m [0mdev[37m [0mserver[37m [0m[1m[1m[35mand[0m[37m [0m[1m[1m[35mto[0m[37m [0mevery[37m [0munit[37m [0mtest:[37m

[0m[1m[30m-[0m[37m [0m[1m[30m**[0mThe[37m [0mpreload[37m [0mcould[37m [0m[1m[1m[35mnot[0m[37m [0m[1m[1m[35mload[0m.[1m[30m**[0m[37m [0m[1m[30m`[0mwebPreferences[1m[30m`[0m[37m [0mdoes[37m [0m[1m[1m[35mnot[0m[37m [0m[1m[32mset[0m[37m [0m[1m[30m`[0msandbox[1m[30m`[0m,[37m [0m[1m[1m[35mand[0m[37m [0mElectron[37m [0mhas[37m
  [0mdefaulted[37m [0mit[37m [0m[1m[1m[35mto[0m[37m [0m[1m[30m`[0m[31mtrue[0m[1m[30m`[0m[37m [0msince[37m [0mv20,[37m [0mso[37m [0m[1m[30m`[0mpreload.js[1m[30m`[0m[37m [0mruns[37m [0msandboxed.[37m [0mA[37m [0msandboxed[37m [0mpreload[37m [0mgets[37m [0ma[37m
  [0mrestricted[37m [0m[1m[30m`[0m[1m[1m[35mrequire[0m[1m[30m`[0m[37m [0mthat[37m [0mresolves[37m [0monly[37m [0mbuilt[1m[30m-[0m[1m[1m[35min[0m[37m [0mElectron[1m[30m/[0mNode[37m [0mmodules[37m [0m—[37m [0mits[37m
  [0m[1m[30m`[0m[1m[1m[35mrequire[0m([1m[30m'../shared/ipcChannels'[0m)[1m[30m`[0m,[37m [0memitted[37m [0m[1m[1m[35mby[0m[37m [0m[1m[30m`[0mtsc[1m[30m`[0m,[37m [0mthrew[37m [0m[1m[30m"module not found"[0m,[37m [0mthe[37m [0mwhole[37m
  [0mpreload[37m [0mwas[37m [0mdiscarded,[37m [0m[1m[1m[35mand[0m[37m [0m[1m[30m`[0mwindow.api[1m[30m`[0m[37m [0mwas[37m [0mnever[37m [0mdefined.[37m
  [0m[1m[30m**[0mDecision:[1m[30m**[0m[37m [0mbundle[37m [0m[1m[30m`[0mpreload.ts[1m[30m`[0m[37m [0m[1m[1m[35mwith[0m[37m [0mesbuild[37m [0m[1m[1m[35minto[0m[37m [0mone[37m [0mself[1m[30m-[0mcontained[37m [0mfile[37m [0mrather[37m [0mthan[37m [0m[1m[32mset[0m[37m
  [0m[1m[30m`[0msandbox:[37m [0m[31mfalse[0m[1m[30m`[0m.[37m [0mKeeping[37m [0mElectron[1m[30m's secure default costs one build step; turning the sandbox
  off to accommodate our build layout would trade a real protection for convenience.
  `tsconfig.main.json` now excludes `preload.ts` from emit (so `tsc` cannot race esbuild over that
  path in watch mode) and `tsconfig.preload.json` typechecks it, since esbuild does not.
- **The renderer'[0ms[37m [0mscript[37m [0m[1m[30m404[0m[1m[30m'd.** Vite'[0ms[37m [0m[1m[1m[35mdefault[0m[37m [0m[1m[30m`[0mbase[1m[30m`[0m[37m [0mof[37m [0m[1m[30m`/`[0m[37m [0memits[37m [0m[1m[30m`[0msrc[1m[30m=[0m[1m[30m"/assets/…"[0m[1m[30m`[0m,[37m [0mwhich[37m [0mover[37m
  [0m[1m[30m`[0mfile:[1m[30m//`[0m[37m [0mresolves[37m [0magainst[37m [0mthe[37m [0mfilesystem[37m [0mroot.[37m [0m[1m[30m**[0mDecision:[1m[30m**[0m[37m [0m[1m[30m`[0mbase:[37m [0m[1m[30m'./'[0m[1m[30m`[0m.[37m

[0m[1m[1m[35mBoth[0m[37m [0mwere[37m [0mdev[1m[30m/[0mprod[37m [0mdivergences:[37m [0m[1m[30m`[0mloadURL[1m[30m`[0m[37m [0mover[37m [0mhttp[37m [0mmade[37m [0m[1m[1m[35meach[0m[37m [0mone[37m [0mwork[37m [0m[1m[1m[35min[0m[37m [0mdevelopment.[37m
[0m[1m[30m`[0mtests[1m[30m/[0mintegration[1m[30m/[0mpackagedRendererAssets.test.ts[1m[30m`[0m[37m [0mnow[37m [0masserts[37m [0m[1m[1m[35mboth[0m[37m [0magainst[37m [0mthe[37m [0m[1m[32mreal[0m[37m [0mbuilt[37m [0mtree,[37m
[0malongside[37m [0mthe[37m [0mexisting[37m [0m[1m[30m`[0mpackagedOutputPath[1m[30m`[0m[37m [0mchecks.[37m [0mTest[37m [0mcount[37m [0m[1m[30m136[0m[37m [0m→[37m [0m[1m[30m139[0m.[37m

[0mNeither[37m [0mbug[37m [0mwas[37m [0mintroduced[37m [0m[1m[1m[35mby[0m[37m [0mCI[37m [0m—[37m [0mCI[37m [0monly[37m [0mmade[37m [0mthem[37m [0mreachable,[37m [0mwhich[37m [0m[1m[1m[35mis[0m[37m [0mthe[37m [0mpoint[37m [0mof[37m [0mit.[37m
[0m