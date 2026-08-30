# ServiceFlow — Design Spec

Date: 2026-08-30
Status: Approved for planning
Last reviewed: 2026-08-30 (PM review — see "Verified data facts" and "Revision log")

## Summary

ServiceFlow is a Windows desktop application for church service operators to
present Bible verses and song lyrics to an OBS live stream, in the spirit of
ProPresenter/OpenLP but scoped tightly to this one workflow. An operator
searches for a Bible chapter or a song, stages it in a running list of items
they expect to need during the service, and clicks a verse or lyric block to
put it live on the OBS output immediately. No custom OBS plugin is required —
OBS consumes the output via a Browser Source pointed at a URL served by
ServiceFlow.

## Goals

- Fast search and staging of 3-4+ Bible chapters/songs during a live service,
  with instant switching between staged items.
- Single-click-to-live verse/lyric selection with keyboard (arrow key)
  navigation.
- Toggle between structured browse (book/chapter name, song title) and free
  full-text content search.
- Reuse the church's existing OpenLP song and Bible libraries (KJV, NET and
  NKJV are all present) via a one-time, re-runnable import, with the active
  translation selectable in Settings.
- Put a verse or lyric block on the stream, and take it off again, without
  ever showing the congregation the wrong reference.
- OBS integration via a standard Browser Source — no custom OBS plugin.
- Works on a single Windows machine, or with the operator and OBS on separate
  machines on the same local network.

## Acceptance criteria

v1 is done when, on the church's own Windows PC with the church's own OpenLP
files:

1. A cold import of `songs.sqlite` + all three translation files completes
   with a per-file summary and zero unexplained skips.
2. Every imported song has the same number of blocks as its OpenLP source
   has `<verse>` elements (spot-checked against "How Sweet the name of Jesus
   Sounds", which has six).
3. Browsing to any book in any imported translation shows that translation's
   own text under that translation's own book name — no cross-translation
   bleed (spot-check Romans 1:1 and Acts 1:1 in KJV *and* NET; their source
   book IDs are swapped between those two files).
4. From an empty search box, the operator can put a named verse on the stream
   in under 5 seconds.
5. Any verse in the imported translations renders fully inside the frame at
   1920×1080 — including Esther 8:9 (534 characters).
6. Killing the app mid-service and relaunching restores the staged list and
   the live item exactly.
7. The output can be blanked and restored with a single keystroke.

## Non-goals (v1)

- Multi-verse ranges (single verse only).
- Separate preview/live (program) staging — clicking a verse goes live
  immediately.
- An in-app confidence-monitor preview of the OBS output — the operator uses
  OBS's own source preview.
- In-app song creation/editing — v1 presents from the imported library only.
- Preserving OpenLP's suggested verse order/repeats for songs — v1 shows each
  block once, in document order.
- Auto-update, code signing, multi-operator support, NDI or window-capture
  output.

## Verified data facts (from the church's real OpenLP files)

These were measured directly against `openlp/songs.sqlite`, `openlp/KJV.sqlite`,
`openlp/New English Translation (NET).sqlite` and `openlp/New King James
Version (NKJV).sqlite`. They are the reason for several design decisions below
and must not be re-assumed away.

- **Source `book.id` is not stable across translation files.** In `KJV.sqlite`,
  `id=44` is Romans and `id=45` is Acts; in NET and NKJV those are swapped
  (`44`=Acts, `45`=Romans). Keying books by the source ID alone would caption
  KJV's Romans as "Acts". Books are therefore keyed by
  `(translation, source_book_id)`, and verses hang off that surrogate key.
- **`book.id` is not a display order either.** KJV lists Romans before Acts.
  `book_reference_id` gives the canonical order, but it is not unique
  (KJV maps `15` to both Ezra and Esdras), so it is used for sorting only.
- **Song blocks can repeat a `(type, label)` pair.** "How Sweet the name of
  Jesus Sounds" has six `<verse>` elements but only three distinct
  `(type, label)` pairs. Blocks are therefore identified by their position in
  the document, never by their label.
- **`verse type` is not always a single letter.** Across 556 songs: `v`×2136,
  `c`×6, but also `Verse`×95, `Chorus`×21, `Ending`×1. The type normalizer
  must accept both spellings.
- **KJV includes 12 apocryphal books** (source IDs 67-78, `testament_reference_id`
  = 3) and one verse numbered 0 (Sirach 1:0, 3,133 characters). NET and NKJV
  have 66 books each.
- **Verses get long.** 279 canonical KJV verses exceed 300 characters; the
  longest is Esther 8:9 at 534. The output page must fit text to the frame.
- **109 songs use typographic apostrophes (`’`).** Search must normalize them
  or `believer's` will never match `believer’s`.
- Book names differ slightly between files ("Psalms"/"Psalm", "Songs of
  Solomon"/"Song of Solomon"). Each translation keeps its own names.

## Architecture

A single Electron application (TypeScript + React) with three logical parts
that all run inside one process tree:

1. **Renderer (operator UI)** — the React app the operator interacts with:
   search, staging list, verse/block navigation, settings.
2. **Main process** — owns the SQLite database, runs an embedded HTTP +
   WebSocket server (Express + `ws`), and is the single source of truth for
   staged items and current live state. The renderer talks to it over
   Electron IPC.
3. **Output page** — a static HTML/CSS/vanilla-JS page served by the embedded
   server at `/output`. OBS loads this URL as a Browser Source. It opens a
   WebSocket connection, receives the current live state immediately on
   connect, and re-renders on every subsequent `live_update` push.

```
 ┌─────────────────────────┐        IPC        ┌───────────────────────────┐
 │  Renderer (React UI)     │ <───────────────> │  Main process              │
 │  search / stage / click  │                    │  - SQLite (better-sqlite3) │
 └─────────────────────────┘                    │  - HTTP+WS server (0.0.0.0)│
                                                  └──────────────┬─────────────┘
                                                                 │ WebSocket
                                                                 │ (LAN or localhost)
                                                     ┌───────────▼───────────┐
                                                     │  /output page (OBS     │
                                                     │  Browser Source)       │
                                                     └────────────────────────┘
```

The embedded server binds `0.0.0.0` (not just `localhost`) so the operator's
machine and the OBS machine can be the same computer or two computers on the
same local network. The Settings screen shows both the localhost URL and the
detected LAN URL for `/output`, with copy-to-clipboard buttons and short
setup instructions for adding a Browser Source in OBS (paste URL, set
resolution, enable transparent background).

## Data model

SQLite database (`better-sqlite3`), owned exclusively by ServiceFlow:

- `bible_books` (id surrogate, translation, source_book_id, name, testament,
  sort_order) with `UNIQUE(translation, source_book_id)` — one row per book
  *per translation*, so two translations can disagree about which source ID
  means which book. `sort_order` comes from OpenLP's `book_reference_id`.
- `bible_verses` (id, book_id → `bible_books.id`, chapter, verse, text) with
  `UNIQUE(book_id, chapter, verse)` — the translation is implied by the book,
  so no query can accidentally mix translations.
- `bible_verses_fts` — FTS5 virtual table mirroring `text` for content search.
- `songs` (id, title, ccli_number nullable)
- `song_blocks` (id, song_id, label, text, display_order) with
  `UNIQUE(song_id, display_order)` — one row per `<verse>` element in the
  OpenLP XML, in document order. Labels are display text only and may repeat.
- `song_blocks_fts` — FTS5 mirror for lyric content search.
- `staged_items` (id, type: `bible`|`song`, ref_id, chapter nullable,
  position) — the operator's current staged list. For Bible items `ref_id` is
  a `bible_books.id`, which already carries the translation. Written
  immediately on every stage/unstage/reorder so it survives a restart.
- `live_state` (singleton row: staged_item_id, verse_or_block_id, style_id,
  hidden, updated_at) — what's currently on the OBS output. Written
  immediately on every click-to-live so a crash mid-service loses nothing.
- `output_styles` (id, content_type: `bible`|`song`, name, template_key,
  settings JSON, is_active) — the 3-4 preset visual styles per content type,
  plus which one is currently active for each type.
- `app_settings` (key, value) — small operator preferences; v1 stores the
  active Bible translation here.

## OpenLP import

A one-time, re-runnable action (Settings > "Import from OpenLP", available
in-app so a non-technical volunteer can use it, not a separate CLI tool).
The operator selects one or more `.sqlite` files; ServiceFlow identifies each
one by inspecting its schema (a `songs` table vs. a `verse` + `metadata`
table) rather than by filename, opens it **read-only**, maps it into the
tables above, and reports a **per-file** summary (file, kind, counts
imported, any skipped/malformed rows with reasons) plus a total.

Re-running it is safe and self-healing:

- Songs are upserted by title; a song's blocks are replaced wholesale on
  re-import, so blocks deleted in OpenLP do not linger.
- Bible books are upserted by `(translation, source_book_id)` and verses by
  `(book_id, chapter, verse)`.
- Text is normalized for search (typographic apostrophes folded to ASCII)
  before it reaches the FTS index; the displayed text keeps its original
  punctuation.
- One malformed row never aborts the run.

## Operator UI / UX flow

**Search panel** (left): a mode toggle — `Bible` / `Songs` — and within each
mode a second toggle — `Browse` / `Content search`. Search is live-as-you-type,
debounced. Bible searches are scoped to the translation selected in Settings.

- Bible browse: type-ahead on book name → select book → list/grid of chapters
  → select a chapter.
- Song browse: type-ahead on song title → select a song.
- Content search: free-text query hits the FTS5 index across verse text or
  song lyrics; each result shows its parent reference (book/chapter/verse, or
  song + block) and can be staged directly. Staging from a content-search
  result stages the parent chapter/song, makes it the active item, and
  scrolls to and highlights the matched verse/block in the content pane — it
  does **not** put it live.

Selecting a result in the search panel stages it: it is appended to the
**staged list** (center panel), a persistent, unlimited-length list of items
the operator expects to need — not a fixed bank of slots. Each entry shows
its type and label (e.g. "John 3" or "Amazing Grace"), can be reordered or
removed (✕), and clicking an entry makes it the **active** item for browsing.

The active item's content is shown in the **content pane** (right): for a
staged Bible chapter, the full list of verses 1..N; for a staged song, the
list of blocks in document order. Clicking a verse or block sets it **live**
immediately — it updates `live_state` in the database, which pushes a
WebSocket message to the output page. Up/Down arrow keys move the live
selection to the next/previous verse or block in that same list — this is a
direct live change, not a preview step, consistent with the single-click-live
model.

**Arrow keys only steer the output when the content pane owns focus.** They
must never fire while the operator is typing in the search box or interacting
with Settings; an accidental keystroke in a text field cannot be allowed to
change what the congregation sees.

**Active vs. live are distinct concepts.** The operator can click through
different staged items to browse their content without changing what's on
air; only clicking an actual verse/block changes live output. A persistent
banner in the UI always shows the true current live state as a human-readable
reference — "LIVE: John 3:16" or "LIVE: Amazing Grace — Chorus 1", never an
internal record ID — regardless of which staged item is currently active for
browsing, so the operator is never confused about what the congregation is
actually seeing. When the output is blanked the banner says so explicitly.

**Blanking the output.** A "Hide output" toggle (button plus `Esc`) clears the
Browser Source without losing the current selection; toggling it back restores
the same verse or block. The banner reflects the hidden state. This exists so
the operator has something sane to do during prayer, announcements and the
offering.

Number keys 1-9 are bound to staged-list entries in list order, letting the
operator jump directly to a staged item's content pane without the mouse,
in addition to clicking. `/` or `Ctrl+F` focuses the search box. As with the
arrow keys, these shortcuts are suppressed while a text field has focus.

## OBS output rendering

The `/output` page is deliberately lightweight — static HTML/CSS with a
small vanilla-JS WebSocket client, no React. On connect it requests and
renders the current `live_state` (so adding the Browser Source late, or OBS
restarting, always shows the correct current state, not a blank page). On
each `live_update` push (`{contentType, text, reference, styleId, templateKey,
hidden}`) it swaps content with a brief fade transition.

Text is **fit to the frame**: the output block is height-constrained and the
font scales down (to a readable floor) for long passages, so a 534-character
verse renders inside the safe area instead of running off the top of the
screen. Fitting is measured after render, not guessed from character counts.

Each content type (`bible`, `song`) has its own set of 3-4 preset visual
styles (background treatment, font, accent color, reference/title
placement), bundled as CSS templates. The Settings screen lets the operator
pick which preset is active for Bible output and which is active for Song
output, independently, matching the requirement to style by content type.
Background is transparent by default so OBS composites it as a lower-third
directly over camera/program output without a chroma key.

## Error handling

- OpenLP import never aborts on a bad row — it skips and reports it in the
  per-file summary, so one malformed song doesn't block importing the rest.
- The output page's WebSocket client auto-reconnects with backoff; on every
  (re)connect it re-fetches current `live_state`, so OBS recovering from a
  restart or scene change self-heals without any operator action.
- If the embedded server's preferred port is in use, ServiceFlow binds an
  OS-assigned free port instead and Settings always shows the real, current
  URL. The operator is told the URL changed rather than being asked to
  configure a port.
- Removing the staged item that is currently live clears live state and
  broadcasts that change, so the OBS output never keeps showing content the
  app no longer tracks.
- Empty search results show an explicit "no matches" state.
- Any database write failure (disk full, permissions) surfaces as a visible
  banner in the operator UI — since immediate persistence is the app's
  crash-recovery mechanism, a silent failure there would be worse than a
  loud one. Every renderer→main call routes its rejection into that banner.

## Testing strategy

- Unit tests (Vitest) for the OpenLP import mapping/dedup logic against
  fixture databases, the SQLite data-access layer, and FTS query building.
  The importer fixtures must reproduce the real-world edge cases listed under
  "Verified data facts" — swapped book IDs between translations, repeated
  `(type, label)` pairs, and full-word verse types.
- Component tests (React Testing Library) for staging, switching the active
  item, arrow-key live navigation, and the focus guard that prevents arrow
  keys from firing while typing.
- An integration test that boots the embedded server in-process, connects a
  WebSocket client, and asserts the correct `live_update` payload shape when
  live state changes — including the blanked state.
- A manual pass with real OBS before first live use: add the Browser Source,
  confirm transparency, confirm long-verse fitting at 1920×1080, confirm LAN
  mode end-to-end if a second machine is used, and confirm crash-recovery
  (kill the app mid-session, relaunch, confirm the staged list and live state
  are restored).
- No automated Electron UI end-to-end tests in v1 (e.g. Playwright) — YAGNI
  for a single-operator, single-machine tool; revisit if usage grows.

## Packaging & distribution

`electron-builder` producing a single Windows NSIS installer, with Start
Menu shortcut and uninstaller. Unsigned for v1 (acceptable one-time
SmartScreen click-through for internal church use). No auto-update
mechanism — updates are manual reinstalls, revisited only if ServiceFlow
ever needs to support multiple independent installs at once.

**The installer must be built on Windows** (a Windows PC or a
`windows-latest` CI runner). ServiceFlow bundles `better-sqlite3`, a native
module; `@electron/rebuild` cannot cross-compile it from the Linux/WSL
development machine, so a Linux-produced installer is not trustworthy even
if the build command exits zero.

## Open risks / things to watch

- Windows Defender/SmartScreen will likely flag the unsigned installer on
  first run; document the click-through in setup instructions so it doesn't
  surprise whoever installs it.
- The embedded server is unauthenticated and bound to `0.0.0.0`; anyone on
  the church LAN can load `/output`. Acceptable for a read-only lower-third
  feed on a trusted network, but it should not later grow write endpoints
  without adding auth.
- KJV imports 12 apocryphal books. They are harmless but will appear in book
  browse; if that confuses operators, filter `testament = 'AP'` out of the
  default browse list.
- Electron cannot open a window on this WSL dev machine without WSLg or an X
  server. Any plan step that says "confirm the app boots" needs a real
  desktop session.

## Revision log

**2026-08-30 — PM review.** Verified the plan's assumptions against the
church's actual OpenLP files and corrected three that were wrong (source book
IDs are not stable across translations; song `(type, label)` pairs repeat;
verse `type` is not always a single letter). Added the "Verified data facts"
and "Acceptance criteria" sections. Brought two deferred items into v1 scope:
a blank-output toggle, and a translation picker (the church has three
translations installed and the original design silently reached only KJV).
Tightened arrow-key focus rules, the live banner's contents, output text
fitting, live-state cleanup on unstage, and the packaging platform.
