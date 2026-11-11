# Native Content Model + Bundled KJV — Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking. Work on branch `feat/native-content-model`;
> `main` is never committed to directly (D2).

**Goal:** Make ServiceFlow's own data model the center of the app, with OpenLP as one
optional import source among several. A fresh install ships with a complete KJV Bible
ready to use. Songs and Bibles each have their own import entry point, placed next to
the content they add.

**Why:** Today the Bible side is shaped around OpenLP:
- the only code that writes Bible data is `openlpBibleImporter.ts`;
- `bible_books` is keyed by OpenLP's `source_book_id`;
- translation names come from OpenLP's metadata.

A new install has no content at all and no path to any that doesn't go through OpenLP.

**Greenfield rule:** ServiceFlow is pre-release, so there are no data migrations. The
schema is rewritten in place and developers delete their local `serviceflow.db`
(`%APPDATA%\ServiceFlow\serviceflow.db`, or `~/.config/ServiceFlow/` under WSL).

## Design summary

```
                 ┌──────────────────────────┐
 bundled KJV ───▶│                          │
 (JSON resource) │  bibleRepository         │──▶ bible_translations
                 │   .upsertTranslation()   │    bible_books (book_code)
 OpenLP .sqlite ▶│   .deleteTranslation()   │    bible_verses (+FTS triggers)
 (adapter)       │                          │
 future formats ▶│                          │
                 └──────────────────────────┘
 OpenLP songs ──▶ songRepository.importSongs() ──▶ songs / song_blocks
 in-app editor ─▶ songRepository.createSong()/addBlock()/…  (already exists)
```

- **One write path per content type.** Repositories own transactions, upsert semantics,
  validation and the search index. Import sources only translate their own format into a
  neutral input shape and call the repository.
- **Books are identified by canonical USFM codes** (`GEN` … `REV`, plus deuterocanonical
  codes). OpenLP's book IDs never leave the OpenLP adapter.
- **Translations are a first-class table** keyed by a short `code` (`KJV`). The app
  (settings, search, staged labels) identifies a translation by its code.
- **UI is organized by content type:**
  - Library → Bibles is a new tab that manages translations.
  - Library → Songs gains *Import from OpenLP…*.
  - The Settings import section is removed.

---

## Task 0: Branch + decision record

- [ ] `git checkout -b feat/native-content-model`
- [ ] Add a new entry to `decisions.md`: **"OpenLP is an import source, not the data
      model"**. It should state:
  - the repositories are the only write path;
  - books are keyed by USFM code;
  - translations are keyed by code;
  - a public-domain KJV is bundled and seeded once.
- [ ] In the same commit, add notes to the entries this supersedes:
  - **D5** (upsert-never-delete) still holds, but now lives in
    `bibleRepository.upsertTranslation` and applies to every source.
  - **D-01** (wipe a book's verses when the same source id names a different book) is
    obsolete. Canonical codes can't shift between editions.
  - **I-09b** (fallback-name collision) moves into the OpenLP adapter unchanged.

## Task 1: Canonical book list

**Create:** `src/shared/bibleBooks.ts`, `tests/unit/shared/bibleBooks.test.ts`

- [ ] Export `CANONICAL_BOOKS: { code: string; name: string; testament: 'OT'|'NT'|'AP'; order: number; aliases: string[] }[]`.
  - Include the 66 Protestant books in canonical order.
  - Include the deuterocanonical books carried by KJV-with-Apocrypha files: `TOB JDT ESG WIS
    SIR BAR 1MA 2MA 1ES 2ES MAN` plus `S3Y SUS BEL` as needed. That covers the 12 that
    OpenLP's KJV has.
  - `aliases` holds common alternate names ("Song of Songs", "Canticles", "Revelation of
    John", "1 Kings"/"I Kings"/"First Kings", "Ecclesiasticus" → `SIR`, "Esdras" variants…).
- [ ] Export `bookByCode(code)` and `matchBookByName(name)`. Matching should be
      case-insensitive, punctuation-insensitive and roman-numeral-aware.
- [ ] Tests:
  - 66 canonical books, all codes unique, order is a contiguous sequence;
  - every OpenLP KJV apocryphal book name in the fixtures resolves to a code;
  - "1 John" and "John" don't collide.

## Task 2: Schema + shared types

**Modify:** `src/main/db/schema.ts`, `src/shared/types.ts`, `tests/unit/db/schema.test.ts`

- [ ] Collapse migrations 1–3 into a single baseline migration. Keep the `user_version`
      mechanism for post-release use.
- [ ] Replace the Bible tables:
  ```sql
  CREATE TABLE bible_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,       -- 'KJV'
    name TEXT NOT NULL,                              -- 'King James Version'
    source TEXT NOT NULL CHECK (source IN ('bundled','openlp','file')),
    license_note TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE bible_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    translation_id INTEGER NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
    book_code TEXT NOT NULL,                         -- USFM, from CANONICAL_BOOKS
    name TEXT NOT NULL,                              -- display name as the translation spells it
    testament TEXT NOT NULL CHECK (testament IN ('OT','NT','AP')),
    sort_order INTEGER NOT NULL,                     -- from CANONICAL_BOOKS, never from the source
    UNIQUE(translation_id, book_code)
  );
  ```
  `bible_verses`, its FTS table and its triggers are unchanged. The verse cascade now
  runs translation → books → verses.
- [ ] Replace the OpenLP-specific comment block at the top of the schema with one that
      explains canonical codes.
- [ ] Types:
  - `BibleBook` drops `sourceBookId` and `translation`, and gains `bookCode` and
    `translationCode`.
  - Add `BibleTranslation { code; name; source; licenseNote; bookCount; verseCount }`.
  - Add the neutral input type `TranslationInput { code; name; source; licenseNote?; books: { bookCode; name?; verses: [chapter, verse, text][] }[] }`.
  - Rename `ImportSourceSummary` → `ImportResult`. Its shape stays the same, since it's
    used by every source, not just OpenLP.
- [ ] Schema tests:
  - deleting a translation cascades to its books and verses, and the FTS rows go too;
  - `(translation_id, book_code)` is unique;
  - `code` is case-insensitive unique.

## Task 3: Bible write layer

**Modify:** `src/main/db/bibleRepository.ts`, `tests/unit/db/bibleRepository.test.ts`

- [ ] `upsertTranslation(db, input: TranslationInput): ImportResult`
  - Runs in one outer transaction, so a structural failure leaves the DB untouched
    (carries over D-06).
  - Upserts the translation row by `code` and updates `name`/`source`/`license_note`.
  - Each book: rejects an unknown `bookCode` (skip and report). `name` defaults to
    `CANONICAL_BOOKS` when the source gives none. `sort_order` and `testament` always
    come from `CANONICAL_BOOKS`.
  - Each verse: skip and report non-integer chapter/verse numbers (preserves the
    current check) and empty text. Insert new verses, update changed text, never delete
    (D5).
  - Returns imported/skipped counts with per-row errors.
- [ ] `listTranslations(db): BibleTranslation[]` returns book and verse counts and is
      sorted by code.
- [ ] `deleteTranslation(db, code): { removedBookIds: number[] }`. The caller uses the
      returned IDs to clean up staged and live state (Task 6).
- [ ] Update the read functions:
  - `findBooksByName`, `searchBibleContent` and `getActiveTranslation` take a
    translation **code** and join through `bible_translations`;
  - book matching also checks `CANONICAL_BOOKS` aliases, so "Song of Songs" finds `SNG`
    whatever the translation calls it.
- [ ] Update `stagedItemsRepository`'s label query to join through `bible_translations`
      for the code.
- [ ] Port the data-integrity tests from `openlpBibleImporter.test.ts` that belong to
      the write path:
  - upsert without deleting;
  - changed text gets updated;
  - non-numeric chapter is skipped;
  - one bad book doesn't roll back the rest;
  - FTS stays in sync;
  - atomic on failure.

  Add tests for an unknown book code and for re-upserting with a new `source`.

## Task 4: Song write layer

**Modify:** `src/main/db/songRepository.ts`, `tests/unit/db/songRepository.test.ts`

- [ ] `importSongs(db, songs: { title; ccliNumber; blocks: { label; text }[] }[]): ImportResult`
  - One transaction.
  - Upserts by title and replaces each song's blocks wholesale. This is today's
    semantics, moved here from `openlpSongsImporter.ts`.
  - Reports per-song skips: no blocks, empty title.
- [ ] Tests ported from `openlpSongsImporter.test.ts` for the write semantics:
  - replacing blocks drops removed blocks;
  - duplicate `(type,label)` blocks keep `display_order`;
  - FTS stays in sync.

## Task 5: OpenLP adapters

**Move/modify:** `src/main/import/*` → `src/main/import/openlp/{detect,bible,songs,bookMap,songXml}.ts`;
move the tests to match. `tests/helpers/openlpFixtures.ts` stays.

- [ ] `openlp/bookMap.ts`: OpenLP book row → USFM code.
  - Canonical books: use `book_reference_id` 1–66, but cross-check against
    `matchBookByName`. If they disagree, trust the name and report a warning.
  - Apocryphal books (`testament_reference_id = 3`, or `book_reference_id` > 66): match
    by name only, because KJV reuses `book_reference_id` 15 for Ezra **and** Esdras.
  - No match: skip the book and its verses, and report it. Never guess.
- [ ] `openlp/bible.ts`: `readOpenlpBible(path): TranslationInput`.
  - Derive the code: look the metadata `name` up in a small known-names table ("King
    James Version"/"KJV" → `KJV`, "New King James Version" → `NKJV`, "New English
    Translation" → `NET`). Otherwise use the file basename, trimmed and uppercased. Keep
    the I-09b parent-folder disambiguation.
  - `name` comes from the metadata name, falling back to the code. `source: 'openlp'`.
    `license_note` comes from metadata `copyright` if present.
  - Then `importOpenlpBible(db, path) = upsertTranslation(db, readOpenlpBible(path))`.
  - Importing OpenLP's KJV therefore updates the bundled KJV in place: same code,
    `source` becomes `openlp`.
- [ ] `openlp/songs.ts`: parse the XML as today, then call `songRepository.importSongs`.
      Keep the existing same-file tracking behavior described at the top of the current
      importer.
- [ ] `openlp/detect.ts`: unchanged logic. It's now used to **validate** that the user
      picked the right kind of file, not to route files.
- [ ] Regression tests carried over from the v1 plan's "non-negotiable facts":
  - KJV/NET Romans↔Acts source-ID swap maps to `ROM`/`ACT` correctly in both;
  - KJV Ezra vs. Esdras on `book_reference_id` 15 maps to `EZR` and `1ES` (or the
    right Esdras);
  - Sirach 1:0 is preserved;
  - all 12 KJV apocryphal books map.

## Task 6: IPC + preload

**Modify:** `src/shared/ipcChannels.ts`, `src/main/ipc/handlers.ts`, `src/main/preload.ts`,
`src/renderer/window.d.ts`, `tests/integration/ipcHandlers.test.ts`

- [ ] Remove `PickOpenlpFiles` / `ImportOpenlp` / `handleImportOpenlp`'s routing-by-detection.
- [ ] Add:
  - `bible:list-translations` → `BibleTranslation[]`, replacing today's `string[]`.
  - `bible:delete-translation (code)`. Deletes, then removes `staged_items` rows of type
    `bible` whose `ref_id` is in `removedBookIds`. If live state points at one of them,
    clears live through the existing funnel and broadcasts. If the deleted translation
    was the active one, falls back to the next available.
  - `bible:restore-bundled (code)`. Re-runs the bundled seed for that code, ignoring the
    seeded flag (Task 8).
  - `openlp:pick (kind: 'bible'|'songs')`. Opens the dialog in OpenLP's usual folder:
    - Bibles: `%APPDATA%\openlp\data\bibles`, multi-select.
    - Songs: `%APPDATA%\openlp\data\songs`, single file.

    Falls back to the default location when the folder doesn't exist.
  - `openlp:import-bibles (paths)` / `openlp:import-songs (path)`. Each validates every
    file with `detect`. A wrong-kind file becomes a per-file error ("This looks like an
    OpenLP song database — use Library → Songs → Import"), and the rest of the batch
    still imports. Keep the current home-directory path redaction and the "clear live if
    song rowids changed" safety from `handleImportOpenlp`.
- [ ] Integration tests:
  - wrong-kind rejection in both directions;
  - deleting a translation that's staged and live clears both;
  - deleting the active translation falls back;
  - restore-bundled works after a delete.

## Task 7: Bundled KJV resource

**Create:** `scripts/build-bundled-bible.mjs`, `resources/bibles/kjv.json`,
`tests/unit/content/bundledKjv.test.ts`

- [ ] Source: eBible.org `eng-kjv` in VPL format (`eng-kjv_vpl.zip`, one verse per line:
      `GEN 1:1 In the beginning…`). It's public domain in the US. Download it by hand
      into an empty scratch folder. It's never committed and never fetched at build
      time.
- [ ] The script takes the extracted file as an argument and writes
      `resources/bibles/kjv.json`:
      `{ code: 'KJV', name: 'King James Version', source: 'bundled', licenseNote: 'Public domain (US).', books: [{ bookCode, name, verses: [[c, v, text], …] }] }`.
  - **66 books only** for the basic bundle. If the VPL file contains deuterocanonical
    books, the script drops them (see open question 1).
  - Strips eBible markup (footnote markers, pilcrows `¶`) and normalizes whitespace.
- [ ] The script checks its own output and fails if any check fails:
  - 66 books;
  - 31,102 verses;
  - every `bookCode` is in `CANONICAL_BOOKS`;
  - no empty text.
- [ ] Commit the generated JSON (about 4.5 MB; the installer compresses it). Record the
      source URL and download date in a comment field inside the JSON and in
      `decisions.md`.
- [ ] Tests on the committed file:
  - the counts above;
  - spot checks on Genesis 1:1, John 3:16, Esther 8:9 (the longest verse), Psalm 117
    (2 verses) and 3 John (14 verses).

## Task 8: Packaging + first-run seed

**Create:** `src/main/content/bundledBibles.ts`, `tests/unit/content/bundledBibles.test.ts`
**Modify:** `electron-builder.yml`, `src/main/index.ts`, `src/main/db/settingsRepository.ts`,
`tests/integration/packaged*.test.ts`

- [ ] `electron-builder.yml`: `extraResources: [{ from: resources/bibles, to: bibles }]`.
- [ ] `bundledBiblesDir()` returns `process.resourcesPath/bibles` when packaged and
      `<repo>/resources/bibles` in dev. Follow the existing `packagedOutputPath`
      pattern and its test.
- [ ] `seedBundledBibles(db, { force?: boolean, code?: string })`:
  - For each bundled file: skip if the setting `bundled.<code>.seeded` is set (unless
    `force`) or a translation with that code already exists (unless `force`).
  - Otherwise load the JSON, call `upsertTranslation`, and set the flag.
  - Because of the flag, a KJV the operator deliberately deleted doesn't come back on
    the next launch. *Restore bundled KJV* calls this with `force: true`.
- [ ] Wire it into `index.ts` after `applySchema` and `seedDefaultOutputStyles`.
  - **Measure first:** time a cold seed of 31k verses with FTS triggers on the Windows
    machine.
  - Under ~1.5 s: run it synchronously before the window opens.
  - Otherwise: run it after `did-finish-load`, push a `content:changed` event, and show
    a "Preparing Bible…" state in the search panel until it arrives.
  - Record the measured number in the commit message.
- [ ] `getActiveTranslation` falls back to `KJV` if present, otherwise to the first
      translation.
- [ ] Tests:
  - a fresh DB seeds KJV once;
  - a second launch is a no-op;
  - after a delete, the next launch doesn't re-seed;
  - `force` restores it;
  - an existing OpenLP-sourced KJV isn't overwritten without `force`.

  Packaged-path test: the resource resolves inside a packaged layout.

## Task 9: UI

**Create:** `src/renderer/components/BibleLibraryPanel.tsx`, `src/renderer/components/ImportSummaryList.tsx`,
`tests/component/BibleLibraryPanel.test.tsx`
**Modify:** `LibraryScreen.tsx`, `SongLibraryPanel.tsx`, `SettingsScreen.tsx`, `SearchPanel.tsx`,
`App.tsx`, `styles/app.css`, related component tests

- [ ] `ImportSummaryList`: move the summary list and `describeSkipReason` out of
      `SettingsScreen` unchanged, so both library panels can reuse them.
- [ ] `LibraryScreen`: add `{ key: 'bibles', label: 'Bibles' }` to `CONTENT_TYPES`. The
      list was built to grow.
- [ ] `BibleLibraryPanel`:
  - A row per translation showing the code, name, source badge (Bundled / OpenLP /
    File), book and verse counts, and a **Partial** badge when the verse count is below
    ~90% of 31,102. That makes the NET/NKJV sample files obvious.
  - Per-row **Delete** uses the in-app confirm dialog from `d0290db`. The copy should
    mention that staged items from that translation will be removed.
  - **Restore bundled KJV** shows only when no `KJV` translation exists.
  - **Import from OpenLP…** is a secondary button. It picks Bible files, imports them,
    shows `ImportSummaryList` inline and refreshes the list.
- [ ] `SongLibraryPanel`:
  - Add a secondary **Import from OpenLP…** action in the panel header, with the summary
    shown inline and the list refreshed afterwards.
  - Empty state: "No songs yet — add one, or import from OpenLP."
- [ ] `SettingsScreen`:
  - Delete the "Import from OpenLP" section.
  - The translation picker now lists `BibleTranslation` objects as "KJV — King James
    Version" and stores the code.
- [ ] `SearchPanel`: when there are no translations, the Bible mode shows "No Bibles
      installed — open Library → Bibles" instead of empty results.
- [ ] `App.tsx`: refresh the active translation after delete/import/restore. A simple
      callback from `LibraryScreen` is enough. Handle `content:changed` if Task 8 needed
      the async seed.
- [ ] Component tests:
  - the Bibles panel lists, deletes (with confirm), restores and imports;
  - the Songs panel import button and empty state;
  - Settings no longer renders an import section;
  - SearchPanel shows the no-Bibles empty state.

## Task 10: Docs

- [ ] `README.md`:
  - Rewrite §5 as **"Bibles and songs"**: KJV comes preinstalled, songs are created in
    Library → Songs, and OpenLP import is an optional subsection under each.
  - Update "Known limits": NET/NKJV partial-file note, now flagged in the UI by the
    Partial badge; drop the 36,503-verse KJV figure (bundled KJV is 31,102 verses).
- [ ] `docs/superpowers/specs/2026-08-30-serviceflow-design.md`: mark the v1 constraints
      "no in-app song editor" and "content only from the OpenLP importer" as superseded,
      with a pointer to this plan and the new decision record.

## Task 11: Verification

- [ ] `npm run typecheck` and `npm test` are green.
- [ ] Delete the local `serviceflow.db`, then run `npm run dev`:
  - KJV is present;
  - John 3:16 search works;
  - browse "Song of Songs" works;
  - staging and going live work.
- [ ] Delete KJV in Library → Bibles while it's staged and live. Output clears, staged
      item goes, and a restart doesn't bring KJV back. *Restore bundled KJV* brings it
      back.
- [ ] If the church's OpenLP files are available, import them through each new button:
  - KJV updates in place, with no second "KJV" and the source badge showing OpenLP;
  - NET/NKJV show Partial;
  - songs land in the library;
  - a Bible file chosen under Songs import (and the reverse) is rejected with the
    friendly message.
- [ ] On the Windows machine, run `npm run package`. Install from the NSIS build and run
      the portable exe; both first-launch with KJV. Note the installer size change.

---

## Open questions (defaults chosen; override before starting if you disagree)

1. **Apocrypha in the bundled KJV:** default is **no** (66 books, "basic KJV"). The
   schema and book list support it, so adding it later is just a script flag.
2. **Where the active-translation picker lives:** default is **it stays in Settings**.
   A quick switcher next to the Bible search box is a likely follow-up.
3. **OpenLP KJV import overwriting the bundled text:** default is **yes, in place**, and
   the source becomes `openlp`. *Restore bundled KJV* (with `force`) switches it back.
4. **More bundled public-domain translations** (WEB, ASV): out of scope here. Task 7's
   script is written per translation, so each one is a later one-file addition.
