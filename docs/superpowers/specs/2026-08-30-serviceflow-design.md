# ServiceFlow — Design Spec

Date: 2026-08-30
Status: Approved for planning

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
- Reuse the church's existing OpenLP song and Bible (KJV) libraries via a
  one-time import.
- OBS integration via a standard Browser Source — no custom OBS plugin.
- Works on a single Windows machine, or with the operator and OBS on separate
  machines on the same local network.

## Non-goals (v1)

- Multi-verse ranges (single verse only).
- Separate preview/live (program) staging — clicking a verse goes live
  immediately.
- A dedicated clear/blank-output control — the output always shows the last
  selected item.
- An in-app confidence-monitor preview of the OBS output — the operator uses
  OBS's own source preview.
- In-app song creation/editing — v1 presents from the imported library only.
- Preserving OpenLP's suggested verse order/repeats for songs — v1 shows each
  unique verse/chorus/bridge block once.
- Auto-update, code signing, multi-operator support, NDI or window-capture
  output.

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

- `bible_books` (id, name, testament, sort_order)
- `bible_verses` (id, book_id, chapter, verse, text, translation) — plus an
  FTS5 virtual table `bible_verses_fts` mirroring `text` for content search.
- `songs` (id, title, ccli_number nullable)
- `song_blocks` (id, song_id, label, text, display_order) — one row per
  unique verse/chorus/bridge block, deduplicated from OpenLP's source XML,
  ordered by first appearance — plus `song_blocks_fts` for content search.
- `staged_items` (id, type: `bible`|`song`, ref_id, chapter nullable,
  position) — the operator's current staged list. Written immediately on
  every stage/unstage/reorder so it survives a restart.
- `live_state` (singleton row: staged_item_id, verse_or_block_id, style_id,
  updated_at) — what's currently on the OBS output. Written immediately on
  every click-to-live so a crash mid-service loses nothing.
- `output_styles` (id, content_type: `bible`|`song`, name, template_key,
  settings JSON) — the 3-4 preset visual styles per content type, plus which
  one is currently active for each type.

## OpenLP import

A one-time, re-runnable action (Settings > "Import from OpenLP", available
in-app so a non-technical volunteer can use it, not a separate CLI tool).
It opens the church's existing OpenLP `songs.sqlite` and `bibles.sqlite`
files **read-only**, maps their schema into the tables above, and reports a
summary (counts imported, any skipped/malformed rows with reasons).
Re-running it is safe: rows are upserted by natural key (song title;
book/chapter/verse/translation) rather than duplicated, so it can be re-run
after the OpenLP library changes.

## Operator UI / UX flow

**Search panel** (left): a mode toggle — `Bible` / `Songs` — and within each
mode a second toggle — `Browse` / `Content search`. Search is live-as-you-type.

- Bible browse: type-ahead on book name → select book → list/grid of chapters
  → select a chapter.
- Song browse: type-ahead on song title → select a song.
- Content search: free-text query hits the FTS5 index across verse text or
  song lyrics; each result shows its parent reference (book/chapter/verse, or
  song + block) and can be staged directly, jumping straight to that verse or
  block once staged.

Selecting a result in the search panel stages it: it is appended to the
**staged list** (center panel), a persistent, unlimited-length list of items
the operator expects to need — not a fixed bank of slots. Each entry shows
its type and label (e.g. "John 3" or "Amazing Grace"), can be reordered or
removed (✕), and clicking an entry makes it the **active** item for browsing.

The active item's content is shown in the **content pane** (right): for a
staged Bible chapter, the full list of verses 1..N; for a staged song, the
list of unique blocks. Clicking a verse or block sets it **live** immediately
— it updates `live_state` in the database, which pushes a WebSocket message
to the output page. Up/Down arrow keys (when the content pane has focus) move
the live selection to the next/previous verse or block in that same list —
this is a direct live change, not a preview step, consistent with the
single-click-live model.

**Active vs. live are distinct concepts.** The operator can click through
different staged items to browse their content without changing what's on
air; only clicking an actual verse/block changes live output. A persistent
banner in the UI always shows the true current live state (e.g. "LIVE: John
3:16" or "LIVE: Amazing Grace — Chorus") regardless of which staged item is
currently active for browsing, so the operator is never confused about what
the congregation/stream is actually seeing.

Number keys 1-9 are bound to staged-list entries in list order, letting the
operator jump directly to a staged item's content pane without the mouse,
in addition to clicking. `/` or `Ctrl+F` focuses the search box.

## OBS output rendering

The `/output` page is deliberately lightweight — static HTML/CSS with a
small vanilla-JS WebSocket client, no React. On connect it requests and
renders the current `live_state` (so adding the Browser Source late, or OBS
restarting, always shows the correct current state, not a blank page). On
each `live_update` push (`{contentType, text, reference, styleId}`) it swaps
content with a brief fade transition.

Each content type (`bible`, `song`) has its own set of 3-4 preset visual
styles (background treatment, font, accent color, reference/title
placement), bundled as CSS templates. The Settings screen lets the operator
pick which preset is active for Bible output and which is active for Song
output, independently, matching the requirement to style by content type.
Background is transparent by default so OBS composites it as a lower-third
directly over camera/program output without a chroma key.

## Error handling

- OpenLP import never aborts on a bad row — it skips and reports it in the
  summary, so one malformed song doesn't block importing the rest.
- The output page's WebSocket client auto-reconnects with backoff; on every
  (re)connect it re-fetches current `live_state`, so OBS recovering from a
  restart or scene change self-heals without any operator action.
- If the embedded server fails to bind its port (e.g. already in use), the
  operator UI shows a clear, actionable error with a way to change the port
  in Settings, rather than failing silently on launch.
- Empty search results show an explicit "no matches" state.
- Any database write failure (disk full, permissions) surfaces as a visible
  banner in the operator UI — since immediate persistence is the app's
  crash-recovery mechanism, a silent failure there would be worse than a
  loud one.

## Testing strategy

- Unit tests (Vitest) for the OpenLP import mapping/dedup logic against
  fixture databases, the SQLite data-access layer, and FTS query building.
- Component tests (React Testing Library) for staging, switching the active
  item, and arrow-key live navigation.
- An integration test that boots the embedded server in-process, connects a
  WebSocket client, and asserts the correct `live_update` payload shape when
  live state changes.
- A manual pass with real OBS before first live use: add the Browser Source,
  confirm transparency, confirm LAN mode end-to-end if a second machine is
  used, and confirm crash-recovery (kill the app mid-session, relaunch,
  confirm the staged list and live state are restored).
- No automated Electron UI end-to-end tests in v1 (e.g. Playwright) — YAGNI
  for a single-operator, single-machine tool; revisit if usage grows.

## Packaging & distribution

`electron-builder` producing a single Windows NSIS installer, with Start
Menu shortcut and uninstaller. Unsigned for v1 (acceptable one-time
SmartScreen click-through for internal church use). No auto-update
mechanism — updates are manual reinstalls, revisited only if ServiceFlow
ever needs to support multiple independent installs at once.

## Open risks / things to watch

- **No clear/blank control was explicitly deferred**: the output always
  shows the last selected verse/lyric, including during prayer or
  announcements. This was a deliberate choice for v1 simplicity; if it
  proves awkward in real services, it's a small addition (a "hide output"
  toggle that the WebSocket layer already supports structurally).
- Windows Defender/SmartScreen will likely flag the unsigned installer on
  first run; document the click-through in setup instructions so it doesn't
  surprise whoever installs it.
