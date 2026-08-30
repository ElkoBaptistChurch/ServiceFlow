# ServiceFlow v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ServiceFlow v1 — a Windows Electron desktop app that lets a church service operator search/stage Bible chapters and songs (imported from existing OpenLP libraries) and click a verse/lyric block to push it live to an OBS Browser Source, with no custom OBS plugin required.

**Architecture:** A single Electron app. The main process owns a SQLite database (`better-sqlite3`) and runs an embedded Express + `ws` server bound to `0.0.0.0`. The React renderer (operator UI) talks to the main process over IPC. A lightweight static `/output` page (vanilla JS, no framework) is what OBS loads as a Browser Source; it connects over WebSocket and re-renders whenever the main process broadcasts a live-state change.

**Tech Stack:** Electron, TypeScript, React 18, Vite, Express, `ws`, `better-sqlite3` (SQLite + FTS5), `fast-xml-parser`, Vitest + React Testing Library, `electron-builder`.

**Spec:** `docs/superpowers/specs/2026-08-30-serviceflow-design.md`

## Global Constraints

- Target platform is Windows only (v1). No macOS/Linux packaging.
- The embedded server binds `0.0.0.0` (not `localhost`) so OBS can run on a separate LAN machine.
- No preview/live separation — every click/arrow-key move on a verse or song block updates live state immediately.
- No clear/blank-output control in v1 — the output always shows the last live item.
- Songs show each unique verse/chorus/bridge block once, in first-appearance (XML document) order — OpenLP's `verse_order` field is intentionally ignored.
- Single verse per live update — no multi-verse ranges in v1.
- No in-app song editor in v1 — songs and Bible text come only from the OpenLP importer.
- OpenLP source files (the church's `songs.sqlite` / translation `.sqlite` files) are user data, never committed to the repo — `.gitignore` must exclude them.
- The real OpenLP schemas this plan is built against were inspected directly from the church's actual files at `openlp/songs.sqlite` and `openlp/KJV.sqlite` in this repo (untracked) — see Task 5 for the exact column names relied upon.
- Deviation from the spec's error-handling wording: the spec says a port-bind failure should offer "a way to change the port in Settings." Task 8 instead auto-falls-back to an OS-assigned free port and always shows the real current URL in Settings — no manual port field exists in v1. This resolves the same failure mode without adding a settings field purely for an edge case; revisit only if a church's firewall setup specifically needs a fixed, predictable port.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.main.json`
- Create: `tsconfig.renderer.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/main/index.ts` (placeholder window bootstrap, replaced in Task 8)
- Create: `src/main/preload.ts` (placeholder, replaced in Task 8)
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx` (placeholder, replaced in Task 11)
- Create: `src/shared/.gitkeep`
- Test: `tests/unit/sanity.test.ts`

**Interfaces:**
- Produces: a working `npm run dev`, `npm run typecheck`, `npm test`, and `npm run build` pipeline that every later task builds on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "serviceflow",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "dev:renderer": "vite",
    "dev:main": "tsc -p tsconfig.main.json --watch --preserveWatchOutput",
    "dev:electron": "wait-on http://localhost:5173 dist/main/index.js && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron .",
    "dev": "concurrently -k \"npm:dev:renderer\" \"npm:dev:main\" \"npm:dev:electron\"",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    "build:output": "node scripts/copy-output.js",
    "build": "npm run build:renderer && npm run build:main && npm run build:output",
    "typecheck": "tsc -p tsconfig.main.json --noEmit && tsc -p tsconfig.renderer.json --noEmit",
    "test": "vitest run",
    "package": "npm run build && electron-builder",
    "postinstall": "electron-rebuild -f -w better-sqlite3"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "express": "^4.19.2",
    "fast-xml-parser": "^4.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.1",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/better-sqlite3": "^7.6.11",
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.5",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@types/ws": "^8.5.12",
    "@vitejs/plugin-react": "^4.3.1",
    "concurrently": "^8.2.2",
    "cross-env": "^7.0.3",
    "electron": "^32.1.2",
    "electron-builder": "^25.0.5",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.1",
    "wait-on": "^7.2.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.main.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/main/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 3: Create `tsconfig.renderer.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['tests/component/**', 'jsdom']],
    setupFiles: ['tests/setup.ts'],
  },
});
```

- [ ] **Step 6: Create `tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
dist/
dist-electron/
release/
*.sqlite
*.db
openlp/
.DS_Store
```

- [ ] **Step 8: Create the placeholder Electron entry point `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'path';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 9: Create the placeholder preload script `src/main/preload.ts`**

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('api', {});
```

- [ ] **Step 10: Create `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`**

`src/renderer/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ServiceFlow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
createRoot(container).render(<App />);
```

`src/renderer/App.tsx`:

```tsx
export default function App() {
  return <div>ServiceFlow</div>;
}
```

- [ ] **Step 11: Create `src/shared/.gitkeep`** (empty file, so the directory exists for Task 2)

- [ ] **Step 12: Create `scripts/copy-output.js`** (used starting Task 7; safe to add now so `build` works end-to-end)

```js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'output');
const dest = path.join(__dirname, '..', 'dist', 'output');

fs.mkdirSync(dest, { recursive: true });
if (fs.existsSync(src)) {
  fs.cpSync(src, dest, { recursive: true });
}
```

- [ ] **Step 13: Write a sanity test to confirm the test runner works**

`tests/unit/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('test runner sanity check', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 14: Install dependencies and run the full pipeline**

Run: `npm install && npm run typecheck && npm test && npm run build`
Expected: all four commands succeed (build produces `dist/main`, `dist/renderer`, `dist/output`).

- [ ] **Step 15: Manually verify the app boots**

Run: `npm run dev`
Expected: an Electron window opens showing "ServiceFlow". Close the window, stop the dev command.

- [ ] **Step 16: Commit**

```bash
git add package.json tsconfig.main.json tsconfig.renderer.json vite.config.ts vitest.config.ts .gitignore src scripts tests
git commit -m "chore: scaffold Electron + React + TypeScript + Vitest project"
```

---

## Task 2: Shared Types + Database Schema + Client

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/client.ts`
- Test: `tests/unit/db/schema.test.ts`

**Interfaces:**
- Produces: `BibleBook`, `BibleVerse`, `BibleSearchResult`, `Song`, `SongBlock`, `SongSearchResult`, `StagedItemType`, `StagedItem`, `LiveState`, `ContentType`, `OutputStyle`, `OutputPayload`, `ImportSummary`, `Testament` (all in `src/shared/types.ts`) — every later task imports these instead of redefining them.
- Produces: `applySchema(db: Database.Database): void` and `openDatabase(path: string): Database.Database` from `src/main/db/schema.ts` / `client.ts`.

- [ ] **Step 1: Write the failing schema test**

`tests/unit/db/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';

function tableNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[])
    .map((r) => r.name)
    .sort();
}

describe('applySchema', () => {
  it('creates every table the app depends on', () => {
    const db = new Database(':memory:');
    applySchema(db);
    const names = tableNames(db);
    for (const expected of [
      'bible_books',
      'bible_verses',
      'song_blocks',
      'songs',
      'staged_items',
      'live_state',
      'output_styles',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('seeds exactly one live_state row', () => {
    const db = new Database(':memory:');
    applySchema(db);
    const rows = db.prepare('SELECT * FROM live_state').all();
    expect(rows).toHaveLength(1);
  });

  it('is idempotent when applied twice', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
    const rows = db.prepare('SELECT * FROM live_state').all();
    expect(rows).toHaveLength(1);
  });

  it('supports FTS5 search on bible_verses via bible_verses_fts', () => {
    const db = new Database(':memory:');
    applySchema(db);
    db.prepare(
      `INSERT INTO bible_books (id, name, testament, sort_order) VALUES (1, 'Genesis', 'OT', 1)`
    ).run();
    const info = db
      .prepare(
        `INSERT INTO bible_verses (book_id, chapter, verse, text, translation) VALUES (1, 1, 1, 'In the beginning God created the heaven and the earth.', 'KJV')`
      )
      .run();
    db.prepare(`INSERT INTO bible_verses_fts (rowid, text) VALUES (?, ?)`).run(
      info.lastInsertRowid,
      'In the beginning God created the heaven and the earth.'
    );
    const results = db
      .prepare(
        `SELECT bv.text FROM bible_verses_fts JOIN bible_verses bv ON bv.id = bible_verses_fts.rowid WHERE bible_verses_fts MATCH 'beginning'`
      )
      .all();
    expect(results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/db/schema.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/db/schema'`.

- [ ] **Step 3: Write `src/shared/types.ts`**

```ts
export type ContentType = 'bible' | 'song';
export type Testament = 'OT' | 'NT' | 'AP';
export type StagedItemType = ContentType;

export interface BibleBook {
  id: number;
  name: string;
  testament: Testament;
  sortOrder: number;
}

export interface BibleVerse {
  id: number;
  bookId: number;
  chapter: number;
  verse: number;
  text: string;
  translation: string;
}

export interface BibleSearchResult {
  verse: BibleVerse;
  bookName: string;
}

export interface Song {
  id: number;
  title: string;
  ccliNumber: string | null;
}

export interface SongBlock {
  id: number;
  songId: number;
  label: string;
  text: string;
  displayOrder: number;
}

export interface SongSearchResult {
  block: SongBlock;
  songTitle: string;
}

export interface StagedItem {
  id: number;
  type: StagedItemType;
  refId: number;
  chapter: number | null;
  position: number;
  label: string;
}

export interface LiveState {
  stagedItemId: number | null;
  verseOrBlockId: number | null;
  styleId: number | null;
  updatedAt: string;
}

export interface OutputStyle {
  id: number;
  contentType: ContentType;
  name: string;
  templateKey: string;
  settings: Record<string, unknown>;
  isActive: boolean;
}

export interface OutputPayload {
  contentType: ContentType | null;
  text: string | null;
  reference: string | null;
  styleId: number | null;
  templateKey: string | null;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: { identifier: string; reason: string }[];
}
```

- [ ] **Step 4: Write `src/main/db/schema.ts`**

```ts
import Database from 'better-sqlite3';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bible_books (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  testament TEXT NOT NULL CHECK (testament IN ('OT','NT','AP')),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bible_verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES bible_books(id),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  translation TEXT NOT NULL,
  UNIQUE(book_id, chapter, verse, translation)
);
CREATE INDEX IF NOT EXISTS idx_bible_verses_lookup ON bible_verses(book_id, chapter, translation);

CREATE VIRTUAL TABLE IF NOT EXISTS bible_verses_fts USING fts5(
  text, content='bible_verses', content_rowid='id', tokenize='porter'
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  ccli_number TEXT
);

CREATE TABLE IF NOT EXISTS song_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  UNIQUE(song_id, label)
);
CREATE INDEX IF NOT EXISTS idx_song_blocks_song ON song_blocks(song_id, display_order);

CREATE VIRTUAL TABLE IF NOT EXISTS song_blocks_fts USING fts5(
  text, content='song_blocks', content_rowid='id', tokenize='porter'
);

CREATE TABLE IF NOT EXISTS staged_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('bible','song')),
  ref_id INTEGER NOT NULL,
  chapter INTEGER,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  staged_item_id INTEGER,
  verse_or_block_id INTEGER,
  style_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS output_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL CHECK (content_type IN ('bible','song')),
  name TEXT NOT NULL,
  template_key TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 0
);
`;

export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.prepare(`INSERT OR IGNORE INTO live_state (id, updated_at) VALUES (1, ?)`).run(new Date().toISOString());
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/db/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write `src/main/db/client.ts`**

```ts
import Database from 'better-sqlite3';
import { applySchema } from './schema';

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  applySchema(db);
  return db;
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/shared/types.ts src/main/db/schema.ts src/main/db/client.ts tests/unit/db/schema.test.ts
git commit -m "feat: add shared types and SQLite schema/client"
```

---

## Task 3: Content Repositories (Bible + Song)

**Files:**
- Create: `src/main/db/fts.ts`
- Create: `src/main/db/bibleRepository.ts`
- Create: `src/main/db/songRepository.ts`
- Test: `tests/unit/db/bibleRepository.test.ts`
- Test: `tests/unit/db/songRepository.test.ts`

**Interfaces:**
- Consumes: `applySchema` (Task 2), `BibleBook`/`BibleVerse`/`BibleSearchResult`/`Song`/`SongBlock`/`SongSearchResult` (Task 2).
- Produces: `toFtsQuery(raw: string): string`; `findBooksByName`, `getChaptersForBook`, `getVersesForChapter`, `searchBibleContent` from `bibleRepository.ts`; `findSongsByTitle`, `getBlocksForSong`, `searchSongContent` from `songRepository.ts` — these are what the IPC handlers (Task 8) and the importers (Task 5, read-side of the resulting data) rely on.

- [ ] **Step 1: Write the failing tests**

`tests/unit/db/bibleRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  findBooksByName,
  getChaptersForBook,
  getVersesForChapter,
  searchBibleContent,
} from '../../../src/main/db/bibleRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare(`INSERT INTO bible_books (id, name, testament, sort_order) VALUES (1, 'John', 'NT', 43)`).run();
  db.prepare(`INSERT INTO bible_books (id, name, testament, sort_order) VALUES (2, 'Genesis', 'OT', 1)`).run();

  const insertVerse = db.prepare(
    `INSERT INTO bible_verses (book_id, chapter, verse, text, translation) VALUES (?, ?, ?, ?, ?)`
  );
  const insertFts = db.prepare(`INSERT INTO bible_verses_fts (rowid, text) VALUES (?, ?)`);
  const rows = [
    [1, 3, 16, 'For God so loved the world, that he gave his only begotten Son.'],
    [1, 3, 17, 'For God sent not his Son into the world to condemn the world.'],
    [1, 1, 1, 'In the beginning was the Word.'],
  ] as const;
  for (const [bookId, chapter, verse, text] of rows) {
    const info = insertVerse.run(bookId, chapter, verse, text, 'KJV');
    insertFts.run(info.lastInsertRowid, text);
  }
});

describe('bibleRepository', () => {
  it('finds books by partial name', () => {
    expect(findBooksByName(db, 'joh').map((b) => b.name)).toEqual(['John']);
  });

  it('lists distinct chapters for a book', () => {
    expect(getChaptersForBook(db, 1, 'KJV')).toEqual([1, 3]);
  });

  it('lists verses for a chapter in verse order', () => {
    const verses = getVersesForChapter(db, 1, 3, 'KJV');
    expect(verses.map((v) => v.verse)).toEqual([16, 17]);
    expect(verses[0].text).toContain('loved the world');
  });

  it('finds verses by content search', () => {
    const results = searchBibleContent(db, 'begotten', 'KJV');
    expect(results).toHaveLength(1);
    expect(results[0].bookName).toBe('John');
    expect(results[0].verse.verse).toBe(16);
  });

  it('does not throw on punctuation in the search query', () => {
    expect(() => searchBibleContent(db, 'God\'s "love"!', 'KJV')).not.toThrow();
  });
});
```

`tests/unit/db/songRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { findSongsByTitle, getBlocksForSong, searchSongContent } from '../../../src/main/db/songRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare(`INSERT INTO songs (id, title) VALUES (1, 'Amazing Grace')`).run();
  const insertBlock = db.prepare(
    `INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (?, ?, ?, ?)`
  );
  const insertFts = db.prepare(`INSERT INTO song_blocks_fts (rowid, text) VALUES (?, ?)`);
  const blocks = [
    ['Verse 1', 'Amazing grace, how sweet the sound', 0],
    ['Chorus 1', 'My chains are gone, I\'ve been set free', 1],
  ] as const;
  for (const [label, text, order] of blocks) {
    const info = insertBlock.run(1, label, text, order);
    insertFts.run(info.lastInsertRowid, text);
  }
});

describe('songRepository', () => {
  it('finds songs by partial title', () => {
    expect(findSongsByTitle(db, 'amaz').map((s) => s.title)).toEqual(['Amazing Grace']);
  });

  it('lists blocks for a song in display order', () => {
    const blocks = getBlocksForSong(db, 1);
    expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus 1']);
  });

  it('finds blocks by content search', () => {
    const results = searchSongContent(db, 'chains');
    expect(results).toHaveLength(1);
    expect(results[0].songTitle).toBe('Amazing Grace');
    expect(results[0].block.label).toBe('Chorus 1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/db/bibleRepository.test.ts tests/unit/db/songRepository.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/main/db/fts.ts`**

```ts
export function toFtsQuery(raw: string): string {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return tokens.length > 0 ? tokens.join(' ') : '""';
}
```

- [ ] **Step 4: Write `src/main/db/bibleRepository.ts`**

```ts
import Database from 'better-sqlite3';
import { BibleBook, BibleSearchResult, BibleVerse, Testament } from '../../shared/types';
import { toFtsQuery } from './fts';

function rowToBook(row: any): BibleBook {
  return { id: row.id, name: row.name, testament: row.testament as Testament, sortOrder: row.sort_order };
}

function rowToVerse(row: any): BibleVerse {
  return { id: row.id, bookId: row.book_id, chapter: row.chapter, verse: row.verse, text: row.text, translation: row.translation };
}

export function findBooksByName(db: Database.Database, query: string): BibleBook[] {
  const rows = db
    .prepare(`SELECT * FROM bible_books WHERE name LIKE ? ORDER BY sort_order LIMIT 20`)
    .all(`%${query}%`);
  return rows.map(rowToBook);
}

export function getChaptersForBook(db: Database.Database, bookId: number, translation: string): number[] {
  const rows = db
    .prepare(`SELECT DISTINCT chapter FROM bible_verses WHERE book_id = ? AND translation = ? ORDER BY chapter`)
    .all(bookId, translation) as { chapter: number }[];
  return rows.map((r) => r.chapter);
}

export function getVersesForChapter(db: Database.Database, bookId: number, chapter: number, translation: string): BibleVerse[] {
  const rows = db
    .prepare(`SELECT * FROM bible_verses WHERE book_id = ? AND chapter = ? AND translation = ? ORDER BY verse`)
    .all(bookId, chapter, translation);
  return rows.map(rowToVerse);
}

export function searchBibleContent(db: Database.Database, query: string, translation: string, limit = 25): BibleSearchResult[] {
  const rows = db
    .prepare(
      `SELECT bv.*, bb.name as book_name
       FROM bible_verses_fts
       JOIN bible_verses bv ON bv.id = bible_verses_fts.rowid
       JOIN bible_books bb ON bb.id = bv.book_id
       WHERE bible_verses_fts MATCH ? AND bv.translation = ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(toFtsQuery(query), translation, limit) as any[];
  return rows.map((r) => ({ verse: rowToVerse(r), bookName: r.book_name }));
}
```

- [ ] **Step 5: Write `src/main/db/songRepository.ts`**

```ts
import Database from 'better-sqlite3';
import { Song, SongBlock, SongSearchResult } from '../../shared/types';
import { toFtsQuery } from './fts';

function rowToSong(row: any): Song {
  return { id: row.id, title: row.title, ccliNumber: row.ccli_number };
}

function rowToBlock(row: any): SongBlock {
  return { id: row.id, songId: row.song_id, label: row.label, text: row.text, displayOrder: row.display_order };
}

export function findSongsByTitle(db: Database.Database, query: string): Song[] {
  const rows = db.prepare(`SELECT * FROM songs WHERE title LIKE ? ORDER BY title LIMIT 20`).all(`%${query}%`);
  return rows.map(rowToSong);
}

export function getBlocksForSong(db: Database.Database, songId: number): SongBlock[] {
  const rows = db.prepare(`SELECT * FROM song_blocks WHERE song_id = ? ORDER BY display_order`).all(songId);
  return rows.map(rowToBlock);
}

export function searchSongContent(db: Database.Database, query: string, limit = 25): SongSearchResult[] {
  const rows = db
    .prepare(
      `SELECT sb.*, s.title as song_title
       FROM song_blocks_fts
       JOIN song_blocks sb ON sb.id = song_blocks_fts.rowid
       JOIN songs s ON s.id = sb.song_id
       WHERE song_blocks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(toFtsQuery(query), limit) as any[];
  return rows.map((r) => ({ block: rowToBlock(r), songTitle: r.song_title }));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/db/bibleRepository.test.ts tests/unit/db/songRepository.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/main/db/fts.ts src/main/db/bibleRepository.ts src/main/db/songRepository.ts tests/unit/db/bibleRepository.test.ts tests/unit/db/songRepository.test.ts
git commit -m "feat: add bible and song content repositories with FTS5 search"
```

---

## Task 4: Staged Items, Live State, and Output Styles Repositories

**Files:**
- Create: `src/main/db/stagedItemsRepository.ts`
- Create: `src/main/db/liveStateRepository.ts`
- Create: `src/main/db/outputStylesRepository.ts`
- Test: `tests/unit/db/stagedItemsRepository.test.ts`
- Test: `tests/unit/db/liveStateRepository.test.ts`
- Test: `tests/unit/db/outputStylesRepository.test.ts`

**Interfaces:**
- Consumes: `bible_books`/`songs` tables and `applySchema` (Task 2); `StagedItem`, `LiveState`, `OutputStyle`, `ContentType` types (Task 2).
- Produces: `getStagedItems`, `addStagedItem`, `removeStagedItem`, `reorderStagedItems` (staged items); `getLiveState`, `setLiveState` (live state); `getStyles`, `getActiveStyle`, `setActiveStyle`, `seedDefaultOutputStyles` (styles) — all consumed by the IPC handlers in Task 8, and `seedDefaultOutputStyles` also called from `main/index.ts` on startup.

- [ ] **Step 1: Write the failing tests**

`tests/unit/db/stagedItemsRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  addStagedItem,
  getStagedItems,
  removeStagedItem,
  reorderStagedItems,
} from '../../../src/main/db/stagedItemsRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare(`INSERT INTO bible_books (id, name, testament, sort_order) VALUES (1, 'John', 'NT', 43)`).run();
  db.prepare(`INSERT INTO songs (id, title) VALUES (1, 'Amazing Grace')`).run();
});

describe('stagedItemsRepository', () => {
  it('stages a bible chapter with a human-readable label', () => {
    const item = addStagedItem(db, 'bible', 1, 3);
    expect(item.label).toBe('John 3');
    expect(item.position).toBe(0);
  });

  it('stages a song with the song title as label', () => {
    const item = addStagedItem(db, 'song', 1, null);
    expect(item.label).toBe('Amazing Grace');
  });

  it('assigns increasing positions and returns items in position order', () => {
    addStagedItem(db, 'bible', 1, 3);
    addStagedItem(db, 'song', 1, null);
    const items = getStagedItems(db);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
  });

  it('removes a staged item', () => {
    const item = addStagedItem(db, 'song', 1, null);
    removeStagedItem(db, item.id);
    expect(getStagedItems(db)).toHaveLength(0);
  });

  it('reorders staged items', () => {
    const a = addStagedItem(db, 'bible', 1, 3);
    const b = addStagedItem(db, 'song', 1, null);
    reorderStagedItems(db, [b.id, a.id]);
    const items = getStagedItems(db);
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });
});
```

`tests/unit/db/liveStateRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { getLiveState, setLiveState } from '../../../src/main/db/liveStateRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('liveStateRepository', () => {
  it('starts with an empty live state', () => {
    const state = getLiveState(db);
    expect(state.stagedItemId).toBeNull();
    expect(state.verseOrBlockId).toBeNull();
  });

  it('sets and reads back live state', () => {
    const updated = setLiveState(db, 5, 42, 1);
    expect(updated.stagedItemId).toBe(5);
    expect(updated.verseOrBlockId).toBe(42);
    expect(updated.styleId).toBe(1);
    expect(getLiveState(db)).toEqual(updated);
  });
});
```

`tests/unit/db/outputStylesRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  getActiveStyle,
  getStyles,
  seedDefaultOutputStyles,
  setActiveStyle,
} from '../../../src/main/db/outputStylesRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('outputStylesRepository', () => {
  it('seeds four presets per content type with the first active', () => {
    seedDefaultOutputStyles(db);
    const bibleStyles = getStyles(db, 'bible');
    const songStyles = getStyles(db, 'song');
    expect(bibleStyles).toHaveLength(4);
    expect(songStyles).toHaveLength(4);
    expect(getActiveStyle(db, 'bible')?.name).toBe(bibleStyles[0].name);
    expect(getActiveStyle(db, 'song')?.name).toBe(songStyles[0].name);
  });

  it('is idempotent — seeding twice does not duplicate rows', () => {
    seedDefaultOutputStyles(db);
    seedDefaultOutputStyles(db);
    expect(getStyles(db, 'bible')).toHaveLength(4);
  });

  it('changes the active style for a content type', () => {
    seedDefaultOutputStyles(db);
    const styles = getStyles(db, 'bible');
    setActiveStyle(db, 'bible', styles[2].id);
    expect(getActiveStyle(db, 'bible')?.id).toBe(styles[2].id);
    expect(getStyles(db, 'song').filter((s) => s.isActive)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/db/stagedItemsRepository.test.ts tests/unit/db/liveStateRepository.test.ts tests/unit/db/outputStylesRepository.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/main/db/stagedItemsRepository.ts`**

```ts
import Database from 'better-sqlite3';
import { StagedItem, StagedItemType } from '../../shared/types';

function labelFor(db: Database.Database, type: StagedItemType, refId: number, chapter: number | null): string {
  if (type === 'bible') {
    const book = db.prepare(`SELECT name FROM bible_books WHERE id = ?`).get(refId) as { name: string } | undefined;
    return book ? `${book.name} ${chapter}` : `Unknown ${chapter}`;
  }
  const song = db.prepare(`SELECT title FROM songs WHERE id = ?`).get(refId) as { title: string } | undefined;
  return song ? song.title : 'Unknown Song';
}

function rowToStagedItem(db: Database.Database, row: any): StagedItem {
  return {
    id: row.id,
    type: row.type,
    refId: row.ref_id,
    chapter: row.chapter,
    position: row.position,
    label: labelFor(db, row.type, row.ref_id, row.chapter),
  };
}

export function getStagedItems(db: Database.Database): StagedItem[] {
  const rows = db.prepare(`SELECT * FROM staged_items ORDER BY position`).all();
  return rows.map((r) => rowToStagedItem(db, r));
}

export function addStagedItem(db: Database.Database, type: StagedItemType, refId: number, chapter: number | null): StagedItem {
  const maxPos = db.prepare(`SELECT COALESCE(MAX(position), -1) as maxPos FROM staged_items`).get() as { maxPos: number };
  const info = db
    .prepare(`INSERT INTO staged_items (type, ref_id, chapter, position) VALUES (?, ?, ?, ?)`)
    .run(type, refId, chapter, maxPos.maxPos + 1);
  const row = db.prepare(`SELECT * FROM staged_items WHERE id = ?`).get(info.lastInsertRowid);
  return rowToStagedItem(db, row);
}

export function removeStagedItem(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM staged_items WHERE id = ?`).run(id);
}

export function reorderStagedItems(db: Database.Database, orderedIds: number[]): void {
  const update = db.prepare(`UPDATE staged_items SET position = ? WHERE id = ?`);
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  tx(orderedIds);
}
```

- [ ] **Step 4: Write `src/main/db/liveStateRepository.ts`**

```ts
import Database from 'better-sqlite3';
import { LiveState } from '../../shared/types';

function rowToLiveState(row: any): LiveState {
  return {
    stagedItemId: row.staged_item_id,
    verseOrBlockId: row.verse_or_block_id,
    styleId: row.style_id,
    updatedAt: row.updated_at,
  };
}

export function getLiveState(db: Database.Database): LiveState {
  const row = db.prepare(`SELECT * FROM live_state WHERE id = 1`).get();
  return rowToLiveState(row);
}

export function setLiveState(
  db: Database.Database,
  stagedItemId: number | null,
  verseOrBlockId: number | null,
  styleId: number | null
): LiveState {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE live_state SET staged_item_id = ?, verse_or_block_id = ?, style_id = ?, updated_at = ? WHERE id = 1`
  ).run(stagedItemId, verseOrBlockId, styleId, updatedAt);
  return getLiveState(db);
}
```

- [ ] **Step 5: Write `src/main/db/outputStylesRepository.ts`**

```ts
import Database from 'better-sqlite3';
import { ContentType, OutputStyle } from '../../shared/types';

function rowToStyle(row: any): OutputStyle {
  return {
    id: row.id,
    contentType: row.content_type,
    name: row.name,
    templateKey: row.template_key,
    settings: JSON.parse(row.settings),
    isActive: !!row.is_active,
  };
}

export function getStyles(db: Database.Database, contentType: ContentType): OutputStyle[] {
  const rows = db.prepare(`SELECT * FROM output_styles WHERE content_type = ? ORDER BY id`).all(contentType);
  return rows.map(rowToStyle);
}

export function getActiveStyle(db: Database.Database, contentType: ContentType): OutputStyle | undefined {
  const row = db.prepare(`SELECT * FROM output_styles WHERE content_type = ? AND is_active = 1`).get(contentType);
  return row ? rowToStyle(row) : undefined;
}

export function setActiveStyle(db: Database.Database, contentType: ContentType, styleId: number): void {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE output_styles SET is_active = 0 WHERE content_type = ?`).run(contentType);
    db.prepare(`UPDATE output_styles SET is_active = 1 WHERE id = ? AND content_type = ?`).run(styleId, contentType);
  });
  tx();
}

const DEFAULT_STYLES: { contentType: ContentType; name: string; templateKey: string }[] = [
  { contentType: 'bible', name: 'Classic Lower Third', templateKey: 'bible-classic' },
  { contentType: 'bible', name: 'Minimal Caption', templateKey: 'bible-minimal' },
  { contentType: 'bible', name: 'Bold Banner', templateKey: 'bible-bold' },
  { contentType: 'bible', name: 'Centered Full', templateKey: 'bible-centered' },
  { contentType: 'song', name: 'Classic Lower Third', templateKey: 'song-classic' },
  { contentType: 'song', name: 'Minimal Caption', templateKey: 'song-minimal' },
  { contentType: 'song', name: 'Bold Banner', templateKey: 'song-bold' },
  { contentType: 'song', name: 'Centered Full', templateKey: 'song-centered' },
];

export function seedDefaultOutputStyles(db: Database.Database): void {
  const existing = db.prepare(`SELECT COUNT(*) as count FROM output_styles`).get() as { count: number };
  if (existing.count > 0) return;
  const insert = db.prepare(
    `INSERT INTO output_styles (content_type, name, template_key, settings, is_active) VALUES (?, ?, ?, '{}', ?)`
  );
  const tx = db.transaction(() => {
    const seenTypes = new Set<ContentType>();
    for (const style of DEFAULT_STYLES) {
      const isFirstOfType = !seenTypes.has(style.contentType);
      seenTypes.add(style.contentType);
      insert.run(style.contentType, style.name, style.templateKey, isFirstOfType ? 1 : 0);
    }
  });
  tx();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/db/stagedItemsRepository.test.ts tests/unit/db/liveStateRepository.test.ts tests/unit/db/outputStylesRepository.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/main/db/stagedItemsRepository.ts src/main/db/liveStateRepository.ts src/main/db/outputStylesRepository.ts tests/unit/db/stagedItemsRepository.test.ts tests/unit/db/liveStateRepository.test.ts tests/unit/db/outputStylesRepository.test.ts
git commit -m "feat: add staged items, live state, and output styles repositories"
```

---

## Task 5: OpenLP Importers (Songs + Bible)

This task imports from the church's real OpenLP files. Their schemas were inspected
directly (`sqlite3 openlp/songs.sqlite ".schema"` and `sqlite3 openlp/KJV.sqlite ".schema"`
in this repo) rather than assumed from documentation:

- `songs.sqlite` → table `songs(id, title, lyrics, ccli_number, ...)`. `lyrics` is an XML
  string: `<song><lyrics><verse type="v" label="1"><![CDATA[...]]></verse>...</lyrics></song>`.
  Observed `type` codes are `v` (verse) and `c` (chorus); OpenLP's format also defines `b`
  (bridge), `p` (pre-chorus), `i` (intro), `e` (ending), `o` (other), `t` (tag) — handle all
  of them. Each `<verse>` element is already unique in the document (repeats are expressed
  only in the separate, intentionally-ignored `verse_order` field), so document order is
  exactly the "unique blocks in first-appearance order" the spec calls for.
- Bible translation files (e.g. `KJV.sqlite`) → `metadata(key, value)` with `key='name'`
  giving the translation code (`'KJV'`); `book(id, book_reference_id, testament_reference_id, name)`;
  `verse(id, book_id, chapter, verse, text)`. `testament_reference_id` takes values `1`, `2`,
  or `3` in the real data (Old Testament, New Testament, Apocrypha) — map `1→'OT'`, `2→'NT'`,
  anything else→`'AP'`.

**Files:**
- Create: `src/main/import/songXml.ts`
- Create: `src/main/import/openlpSongsImporter.ts`
- Create: `src/main/import/openlpBibleImporter.ts`
- Create: `tests/helpers/openlpFixtures.ts`
- Test: `tests/unit/import/songXml.test.ts`
- Test: `tests/unit/import/openlpSongsImporter.test.ts`
- Test: `tests/unit/import/openlpBibleImporter.test.ts`

**Interfaces:**
- Consumes: `songs`/`song_blocks`/`song_blocks_fts` and `bible_books`/`bible_verses`/`bible_verses_fts` tables (Task 2); `ImportSummary`, `Testament` types (Task 2).
- Produces: `parseSongLyrics(xml: string): ParsedSongBlock[]`, `typeCodeToName(code: string): string`; `importOpenlpSongs(mainDb, openlpSongsDbPath): ImportSummary`; `importOpenlpBible(mainDb, openlpBibleDbPath): ImportSummary` — all consumed by the `openlp:import` IPC handler in Task 8.

- [ ] **Step 1: Write the failing XML parser test**

`tests/unit/import/songXml.test.ts` (the two XML strings below are copied verbatim from
real rows in `openlp/songs.sqlite`):

```ts
import { describe, it, expect } from 'vitest';
import { parseSongLyrics, typeCodeToName } from '../../../src/main/import/songXml';

const ABIDE_WITH_ME_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Abide with me, fast falls the eventide;
The darkness deepens, Lord, with me abide;
When other helpers fail and comforts flee,
Help of the helpless, O abide with me.]]></verse><verse type="v" label="2"><![CDATA[Swift to its close ebbs out life's little day;
Earth's joys grow dim, its glories pass away;
Change and decay in all around I see;
O Thou who changest not, abide with me.]]></verse></lyrics></song>`;

const ALL_CREATURES_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[All creatures of our God and King,
Lift up your voice and with us sing:]]></verse><verse type="c" label="1"><![CDATA[O praise Him, O praise Him,
Hallelujah, hallelujah, hallelujah!]]></verse><verse type="v" label="2"><![CDATA[Thou rushing wind that art so strong,
Ye clouds that sail in heaven along,]]></verse></lyrics></song>`;

describe('parseSongLyrics', () => {
  it('parses multiple verse-only blocks in document order', () => {
    const blocks = parseSongLyrics(ABIDE_WITH_ME_XML);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'v', label: '1' });
    expect(blocks[0].text).toContain('Abide with me, fast falls the eventide');
    expect(blocks[1]).toMatchObject({ type: 'v', label: '2' });
  });

  it('preserves document order across verse and chorus blocks', () => {
    const blocks = parseSongLyrics(ALL_CREATURES_XML);
    expect(blocks.map((b) => `${b.type}${b.label}`)).toEqual(['v1', 'c1', 'v2']);
  });
});

describe('typeCodeToName', () => {
  it('maps known OpenLP type codes to display names', () => {
    expect(typeCodeToName('v')).toBe('Verse');
    expect(typeCodeToName('c')).toBe('Chorus');
    expect(typeCodeToName('b')).toBe('Bridge');
  });

  it('falls back to the uppercased code for unknown types', () => {
    expect(typeCodeToName('x')).toBe('X');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/import/songXml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/import/songXml.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';

export interface ParsedSongBlock {
  type: string;
  label: string;
  text: string;
}

const TYPE_NAMES: Record<string, string> = {
  v: 'Verse',
  c: 'Chorus',
  b: 'Bridge',
  p: 'Pre-Chorus',
  i: 'Intro',
  e: 'Ending',
  o: 'Other',
  t: 'Tag',
};

export function typeCodeToName(code: string): string {
  return TYPE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

export function parseSongLyrics(xml: string): ParsedSongBlock[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    cdataPropName: '__cdata',
  });
  const doc = parser.parse(xml);
  const rawVerses = doc?.song?.lyrics?.verse;
  const verseList = Array.isArray(rawVerses) ? rawVerses : rawVerses ? [rawVerses] : [];
  return verseList.map((v: any) => ({
    type: String(v.type ?? 'o'),
    label: String(v.label ?? '1'),
    text: (typeof v.__cdata === 'string' ? v.__cdata : String(v['#text'] ?? '')).trim(),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/import/songXml.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the fixture helper `tests/helpers/openlpFixtures.ts`**

This recreates the real OpenLP schemas discovered above, so importer tests run against
the same shape of database the church's actual files have, without committing any binary
`.sqlite` fixtures to the repo.

```ts
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function createFixtureSongsDb(
  songs: { title: string; lyrics: string; ccliNumber?: string | null }[]
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-songs-')), 'songs.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE songs (
      id INTEGER NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      lyrics TEXT NOT NULL,
      ccli_number VARCHAR(64)
    );
  `);
  const insert = db.prepare(`INSERT INTO songs (title, lyrics, ccli_number) VALUES (?, ?, ?)`);
  songs.forEach((s) => insert.run(s.title, s.lyrics, s.ccliNumber ?? null));
  db.close();
  return dbPath;
}

export function createFixtureBibleDb(
  translationName: string,
  books: { id: number; name: string; testamentReferenceId: number }[],
  verses: { bookId: number; chapter: number; verse: number; text: string }[]
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-')), 'bible.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER NOT NULL PRIMARY KEY, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
  `);
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('name', ?)`).run(translationName);
  const insertBook = db.prepare(
    `INSERT INTO book (id, book_reference_id, testament_reference_id, name) VALUES (?, ?, ?, ?)`
  );
  books.forEach((b) => insertBook.run(b.id, b.id, b.testamentReferenceId, b.name));
  const insertVerse = db.prepare(`INSERT INTO verse (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  verses.forEach((v) => insertVerse.run(v.bookId, v.chapter, v.verse, v.text));
  db.close();
  return dbPath;
}
```

- [ ] **Step 6: Write the failing songs importer test**

`tests/unit/import/openlpSongsImporter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { importOpenlpSongs } from '../../../src/main/import/openlpSongsImporter';
import { createFixtureSongsDb } from '../../helpers/openlpFixtures';
import { getBlocksForSong, findSongsByTitle } from '../../../src/main/db/songRepository';
import { searchSongContent } from '../../../src/main/db/songRepository';

const ALL_CREATURES_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[All creatures of our God and King,
Lift up your voice and with us sing:]]></verse><verse type="c" label="1"><![CDATA[O praise Him, O praise Him,
Hallelujah, hallelujah, hallelujah!]]></verse><verse type="v" label="2"><![CDATA[Thou rushing wind that art so strong.]]></verse></lyrics></song>`;

let mainDb: Database.Database;

beforeEach(() => {
  mainDb = new Database(':memory:');
  applySchema(mainDb);
});

describe('importOpenlpSongs', () => {
  it('imports songs and their unique blocks in document order', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML, ccliNumber: '12345' },
    ]);

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.errors).toHaveLength(0);
    const song = findSongsByTitle(mainDb, 'All Creatures')[0];
    const blocks = getBlocksForSong(mainDb, song.id);
    expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus 1', 'Verse 2']);
  });

  it('is idempotent — re-importing upserts rather than duplicates', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);

    importOpenlpSongs(mainDb, fixturePath);
    importOpenlpSongs(mainDb, fixturePath);

    expect(findSongsByTitle(mainDb, 'All Creatures')).toHaveLength(1);
    const song = findSongsByTitle(mainDb, 'All Creatures')[0];
    expect(getBlocksForSong(mainDb, song.id)).toHaveLength(3);
  });

  it('makes imported lyrics searchable via FTS', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);
    importOpenlpSongs(mainDb, fixturePath);
    const results = searchSongContent(mainDb, 'Hallelujah');
    expect(results.length).toBeGreaterThan(0);
  });

  it('skips a malformed row and reports it without aborting the rest', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'Broken Song', lyrics: 'not xml at all' },
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors[0].identifier).toBe('Broken Song');
    expect(findSongsByTitle(mainDb, 'All Creatures')).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/unit/import/openlpSongsImporter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Write `src/main/import/openlpSongsImporter.ts`**

Note on the "skip malformed rows" test: `parseSongLyrics('not xml at all')` does not
throw (`fast-xml-parser` tolerates non-XML text and simply produces no `song.lyrics.verse`
node), so it returns an empty block list rather than throwing. Treat zero parsed blocks
as the malformed case explicitly.

```ts
import Database from 'better-sqlite3';
import { ImportSummary } from '../../shared/types';
import { parseSongLyrics, typeCodeToName } from './songXml';

export function importOpenlpSongs(mainDb: Database.Database, openlpSongsDbPath: string): ImportSummary {
  const source = new Database(openlpSongsDbPath, { readonly: true });
  const summary: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  try {
    const rows = source.prepare(`SELECT title, lyrics, ccli_number FROM songs`).all() as any[];

    const upsertSong = mainDb.prepare(
      `INSERT INTO songs (title, ccli_number) VALUES (?, ?)
       ON CONFLICT(title) DO UPDATE SET ccli_number = excluded.ccli_number`
    );
    const getSongId = mainDb.prepare(`SELECT id FROM songs WHERE title = ?`);
    const upsertBlock = mainDb.prepare(
      `INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (?, ?, ?, ?)
       ON CONFLICT(song_id, label) DO UPDATE SET text = excluded.text, display_order = excluded.display_order`
    );
    const getBlockId = mainDb.prepare(`SELECT id FROM song_blocks WHERE song_id = ? AND label = ?`);
    const insertFts = mainDb.prepare(`INSERT OR REPLACE INTO song_blocks_fts (rowid, text) VALUES (?, ?)`);

    const tx = mainDb.transaction((songRows: any[]) => {
      for (const row of songRows) {
        try {
          const blocks = parseSongLyrics(row.lyrics);
          if (blocks.length === 0) {
            throw new Error('lyrics XML contained no verse blocks');
          }
          upsertSong.run(row.title, row.ccli_number ?? null);
          const songId = (getSongId.get(row.title) as { id: number }).id;
          blocks.forEach((block, index) => {
            const label = `${typeCodeToName(block.type)} ${block.label}`;
            upsertBlock.run(songId, label, block.text, index);
            const blockId = (getBlockId.get(songId, label) as { id: number }).id;
            insertFts.run(blockId, block.text);
          });
          summary.imported += 1;
        } catch (err) {
          summary.skipped += 1;
          summary.errors.push({ identifier: row.title, reason: (err as Error).message });
        }
      }
    });
    tx(rows);
  } finally {
    source.close();
  }
  return summary;
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/unit/import/openlpSongsImporter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Write the failing bible importer test**

`tests/unit/import/openlpBibleImporter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { importOpenlpBible } from '../../../src/main/import/openlpBibleImporter';
import { createFixtureBibleDb } from '../../helpers/openlpFixtures';
import { getVersesForChapter, findBooksByName, searchBibleContent } from '../../../src/main/db/bibleRepository';

let mainDb: Database.Database;

beforeEach(() => {
  mainDb = new Database(':memory:');
  applySchema(mainDb);
});

describe('importOpenlpBible', () => {
  it('imports books with the correct testament mapping and verses under the metadata translation code', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 1, name: 'Genesis', testamentReferenceId: 1 },
        { id: 43, name: 'John', testamentReferenceId: 2 },
      ],
      [
        { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth.' },
        { bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son.' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(2);
    expect(summary.errors).toHaveLength(0);
    expect(findBooksByName(mainDb, 'John')[0].testament).toBe('NT');
    expect(findBooksByName(mainDb, 'Genesis')[0].testament).toBe('OT');
    const verses = getVersesForChapter(mainDb, 43, 3, 'KJV');
    expect(verses[0].text).toContain('begotten Son');
    expect(verses[0].translation).toBe('KJV');
  });

  it('maps an unrecognized testament_reference_id to Apocrypha', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 70, name: 'Tobit', testamentReferenceId: 3 }],
      [{ bookId: 70, chapter: 1, verse: 1, text: 'In the days of Enemessar...' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    expect(findBooksByName(mainDb, 'Tobit')[0].testament).toBe('AP');
  });

  it('is idempotent — re-importing upserts verse text rather than duplicating rows', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'Original text.' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    importOpenlpBible(mainDb, fixturePath);
    expect(getVersesForChapter(mainDb, 1, 1, 'KJV')).toHaveLength(1);
  });

  it('makes imported verse text searchable via FTS', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 43, name: 'John', testamentReferenceId: 2 }],
      [{ bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son.' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    expect(searchBibleContent(mainDb, 'begotten', 'KJV')).toHaveLength(1);
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `npx vitest run tests/unit/import/openlpBibleImporter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 12: Write `src/main/import/openlpBibleImporter.ts`**

```ts
import Database from 'better-sqlite3';
import { ImportSummary, Testament } from '../../shared/types';

function mapTestament(testamentReferenceId: number): Testament {
  if (testamentReferenceId === 1) return 'OT';
  if (testamentReferenceId === 2) return 'NT';
  return 'AP';
}

export function importOpenlpBible(mainDb: Database.Database, openlpBibleDbPath: string): ImportSummary {
  const source = new Database(openlpBibleDbPath, { readonly: true });
  const summary: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  try {
    const meta = source.prepare(`SELECT value FROM metadata WHERE key = 'name'`).get() as
      | { value: string }
      | undefined;
    const translation = meta?.value ?? 'UNKNOWN';

    const books = source.prepare(`SELECT id, name, testament_reference_id FROM book`).all() as any[];
    const upsertBook = mainDb.prepare(
      `INSERT INTO bible_books (id, name, testament, sort_order) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, testament = excluded.testament, sort_order = excluded.sort_order`
    );
    const bookTx = mainDb.transaction((bookRows: any[]) => {
      for (const b of bookRows) {
        upsertBook.run(b.id, b.name, mapTestament(b.testament_reference_id), b.id);
      }
    });
    bookTx(books);

    const verses = source.prepare(`SELECT book_id, chapter, verse, text FROM verse`).all() as any[];
    const upsertVerse = mainDb.prepare(
      `INSERT INTO bible_verses (book_id, chapter, verse, text, translation) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(book_id, chapter, verse, translation) DO UPDATE SET text = excluded.text`
    );
    const getVerseId = mainDb.prepare(
      `SELECT id FROM bible_verses WHERE book_id = ? AND chapter = ? AND verse = ? AND translation = ?`
    );
    const insertFts = mainDb.prepare(`INSERT OR REPLACE INTO bible_verses_fts (rowid, text) VALUES (?, ?)`);

    const verseTx = mainDb.transaction((verseRows: any[]) => {
      for (const v of verseRows) {
        try {
          upsertVerse.run(v.book_id, v.chapter, v.verse, v.text, translation);
          const verseRow = getVerseId.get(v.book_id, v.chapter, v.verse, translation) as { id: number };
          insertFts.run(verseRow.id, v.text);
          summary.imported += 1;
        } catch (err) {
          summary.skipped += 1;
          summary.errors.push({ identifier: `${v.book_id}:${v.chapter}:${v.verse}`, reason: (err as Error).message });
        }
      }
    });
    verseTx(verses);
  } finally {
    source.close();
  }
  return summary;
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `npx vitest run tests/unit/import/openlpBibleImporter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 14: Typecheck, run the full test suite, and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/main/import tests/unit/import tests/helpers
git commit -m "feat: import songs and Bible translations from real OpenLP database schemas"
```

---

## Task 6: Embedded HTTP + WebSocket Server

**Files:**
- Create: `src/main/server/server.ts`
- Test: `tests/integration/server.test.ts`

**Interfaces:**
- Consumes: `getLiveState` (Task 4), `getActiveStyle` (Task 4); `bible_verses`/`bible_books`/`song_blocks`/`songs`/`output_styles` tables (Task 2); `OutputPayload` type (Task 2).
- Produces: `createServer(db): ServerHandle` where `ServerHandle = { start(port: number): Promise<number>; stop(): Promise<void>; broadcastLiveUpdate(): void }`, and `buildOutputPayload(db): OutputPayload` — both consumed by `main/index.ts` and `ipc/handlers.ts` in Task 8.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { applySchema } from '../../src/main/db/schema';
import { seedDefaultOutputStyles } from '../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../src/main/db/stagedItemsRepository';
import { setLiveState } from '../../src/main/db/liveStateRepository';
import { createServer, ServerHandle } from '../../src/main/server/server';

let db: Database.Database;
let server: ServerHandle;
let port: number;

function waitForMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('open', () => resolve()));
}

beforeEach(async () => {
  db = new Database(':memory:');
  applySchema(db);
  seedDefaultOutputStyles(db);
  db.prepare(`INSERT INTO bible_books (id, name, testament, sort_order) VALUES (43, 'John', 'NT', 43)`).run();
  db.prepare(
    `INSERT INTO bible_verses (id, book_id, chapter, verse, text, translation) VALUES (1, 43, 3, 16, 'For God so loved the world.', 'KJV')`
  ).run();
  server = createServer(db);
  port = await server.start(0);
});

afterEach(async () => {
  await server.stop();
});

describe('embedded server', () => {
  it('serves the output page over HTTP', async () => {
    const res = await fetch(`http://localhost:${port}/output/`);
    expect(res.status).toBe(200);
  });

  it('returns the current (empty) live state from GET /api/state', async () => {
    const res = await fetch(`http://localhost:${port}/api/state`);
    const body = await res.json();
    expect(body.contentType).toBeNull();
  });

  it('sends the current live state to a client immediately on connect', async () => {
    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null);

    const socket = new WebSocket(`ws://localhost:${port}/ws`);
    await waitForOpen(socket);
    const message = await waitForMessage(socket);

    expect(message.type).toBe('live_update');
    expect(message.payload.contentType).toBe('bible');
    expect(message.payload.reference).toBe('John 3:16');
    socket.close();
  });

  it('broadcasts a live update to connected clients', async () => {
    const socket = new WebSocket(`ws://localhost:${port}/ws`);
    await waitForOpen(socket);
    await waitForMessage(socket); // initial state on connect

    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null);

    const nextMessagePromise = waitForMessage(socket);
    server.broadcastLiveUpdate();
    const message = await nextMessagePromise;

    expect(message.payload.text).toBe('For God so loved the world.');
    socket.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/server/server.ts`**

```ts
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import { getLiveState } from '../db/liveStateRepository';
import { getActiveStyle } from '../db/outputStylesRepository';
import { ContentType, OutputPayload } from '../../shared/types';

const EMPTY_PAYLOAD: OutputPayload = {
  contentType: null,
  text: null,
  reference: null,
  styleId: null,
  templateKey: null,
};

export function buildOutputPayload(db: Database.Database): OutputPayload {
  const live = getLiveState(db);
  if (!live.stagedItemId || !live.verseOrBlockId) return EMPTY_PAYLOAD;

  const stagedItem = db.prepare(`SELECT * FROM staged_items WHERE id = ?`).get(live.stagedItemId) as any;
  if (!stagedItem) return EMPTY_PAYLOAD;

  const contentType = stagedItem.type as ContentType;
  const style = live.styleId
    ? (db.prepare(`SELECT * FROM output_styles WHERE id = ?`).get(live.styleId) as any)
    : getActiveStyle(db, contentType);

  if (contentType === 'bible') {
    const verse = db
      .prepare(
        `SELECT bv.*, bb.name as book_name FROM bible_verses bv JOIN bible_books bb ON bb.id = bv.book_id WHERE bv.id = ?`
      )
      .get(live.verseOrBlockId) as any;
    if (!verse) return EMPTY_PAYLOAD;
    return {
      contentType: 'bible',
      text: verse.text,
      reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
      styleId: style?.id ?? null,
      templateKey: style?.template_key ?? null,
    };
  }

  const block = db
    .prepare(`SELECT sb.*, s.title as song_title FROM song_blocks sb JOIN songs s ON s.id = sb.song_id WHERE sb.id = ?`)
    .get(live.verseOrBlockId) as any;
  if (!block) return EMPTY_PAYLOAD;
  return {
    contentType: 'song',
    text: block.text,
    reference: `${block.song_title} — ${block.label}`,
    styleId: style?.id ?? null,
    templateKey: style?.template_key ?? null,
  };
}

export interface ServerHandle {
  start(port: number): Promise<number>;
  stop(): Promise<void>;
  broadcastLiveUpdate(): void;
}

export function createServer(db: Database.Database): ServerHandle {
  const app = express();
  app.use('/output', express.static(path.join(__dirname, '..', '..', 'output')));
  app.get('/api/state', (_req, res) => {
    res.json(buildOutputPayload(db));
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: 'live_update', payload: buildOutputPayload(db) }));
  });

  function broadcastLiveUpdate(): void {
    const message = JSON.stringify({ type: 'live_update', payload: buildOutputPayload(db) });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  return {
    start(port: number) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '0.0.0.0', () => {
          const address = httpServer.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
    broadcastLiveUpdate,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/server.test.ts`
Expected: PASS (4 tests). Note: `/output/` will 404 until Task 7 adds `src/output/index.html` — if Step 4 is run before Task 7 exists, that first assertion will fail with a 404. Since Task 7 is the very next task and this file must exist for the server to be meaningfully tested end-to-end, create an empty placeholder now so this task is independently green:

`src/output/index.html` (placeholder, replaced with real content in Task 7):

```html
<!doctype html>
<html><body>ServiceFlow Output (placeholder)</body></html>
```

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/main/server/server.ts src/output/index.html tests/integration/server.test.ts
git commit -m "feat: add embedded HTTP+WebSocket server for the OBS output page"
```

---

## Task 7: OBS Output Page

**Files:**
- Modify: `src/output/index.html` (replace Task 6's placeholder)
- Create: `src/output/output.css`
- Create: `src/output/render.js`
- Create: `src/output/output.js`
- Test: `tests/unit/output/render.test.ts`

**Interfaces:**
- Consumes: the `{contentType, text, reference, styleId, templateKey}` shape of `OutputPayload` (Task 2/6), and the `{type: 'live_update', payload}` WebSocket message shape (Task 6).
- Produces: `renderState(state, rootEl)` (pure DOM function, exported from `render.js`) — used by `output.js` and directly unit-tested.

- [ ] **Step 1: Write the failing render test**

`tests/unit/output/render.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderState } from '../../../src/output/render.js';

describe('renderState', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('renders nothing and hides the root when contentType is null', () => {
    renderState({ contentType: null, text: null, reference: null, styleId: null, templateKey: null }, root);
    expect(root.innerHTML).toBe('');
    expect(root.className).toContain('hidden');
  });

  it('renders verse text and reference for a bible payload', () => {
    renderState(
      { contentType: 'bible', text: 'For God so loved the world.', reference: 'John 3:16', styleId: 1, templateKey: 'bible-classic' },
      root
    );
    expect(root.querySelector('.output-text')?.textContent).toBe('For God so loved the world.');
    expect(root.querySelector('.output-reference')?.textContent).toBe('John 3:16');
    expect(root.className).toContain('bible-classic');
    expect(root.className).toContain('visible');
  });

  it('escapes HTML in the verse text to prevent injection', () => {
    renderState(
      { contentType: 'song', text: '<script>alert(1)</script>', reference: 'Test', styleId: 1, templateKey: 'song-classic' },
      root
    );
    expect(root.innerHTML).not.toContain('<script>');
    expect(root.querySelector('.output-text')?.textContent).toBe('<script>alert(1)</script>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/output/render.test.ts`
Expected: FAIL — module not found. (This test needs the `jsdom` environment; confirm `tests/output/**` is covered — since it's under `tests/unit/output`, not `tests/component`, add it to `vitest.config.ts`'s `environmentMatchGlobs` alongside `tests/component/**`.)

- [ ] **Step 3: Update `vitest.config.ts`'s `environmentMatchGlobs`**

```ts
environmentMatchGlobs: [
  ['tests/component/**', 'jsdom'],
  ['tests/unit/output/**', 'jsdom'],
],
```

- [ ] **Step 4: Write `src/output/render.js`**

```js
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderState(state, rootEl) {
  if (!state || !state.contentType) {
    rootEl.innerHTML = '';
    rootEl.className = 'output-root hidden';
    return;
  }
  rootEl.className = `output-root visible ${state.templateKey ?? ''}`;
  rootEl.innerHTML = `
    <div class="output-text">${escapeHtml(state.text ?? '')}</div>
    <div class="output-reference">${escapeHtml(state.reference ?? '')}</div>
  `;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/output/render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write `src/output/output.js`**

```js
import { renderState } from './render.js';

const root = document.getElementById('output-root');

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'live_update') renderState(message.payload, root);
  });
  socket.addEventListener('close', () => setTimeout(connect, 1000));
  socket.addEventListener('error', () => socket.close());
}

fetch('/api/state')
  .then((res) => res.json())
  .then((state) => renderState(state, root))
  .catch(() => {});

connect();
```

- [ ] **Step 7: Write `src/output/output.css`**

```css
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: 'Segoe UI', Arial, sans-serif;
}

.output-root {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 32px 48px;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.output-root.hidden {
  opacity: 0;
}

.output-root.visible {
  opacity: 1;
}

.output-text {
  font-size: 42px;
  font-weight: 600;
  color: #ffffff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
  line-height: 1.3;
}

.output-reference {
  margin-top: 12px;
  font-size: 22px;
  font-weight: 400;
  color: #f0d060;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}

/* Bible presets */
.bible-classic .output-text { border-left: 6px solid #f0d060; padding-left: 20px; }
.bible-minimal .output-text { font-size: 34px; }
.bible-minimal .output-reference { font-size: 18px; }
.bible-bold { background: rgba(10, 10, 20, 0.55); }
.bible-bold .output-text { font-size: 48px; }
.bible-centered { text-align: center; left: 10%; right: 10%; bottom: 15%; }

/* Song presets */
.song-classic .output-text { border-left: 6px solid #6fb2f0; padding-left: 20px; }
.song-minimal .output-text { font-size: 34px; }
.song-minimal .output-reference { font-size: 18px; }
.song-bold { background: rgba(10, 10, 20, 0.55); }
.song-bold .output-text { font-size: 48px; }
.song-centered { text-align: center; left: 10%; right: 10%; bottom: 15%; }
```

- [ ] **Step 8: Replace the placeholder `src/output/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ServiceFlow Output</title>
    <link rel="stylesheet" href="output.css" />
  </head>
  <body>
    <div id="output-root" class="output-root hidden"></div>
    <script type="module" src="output.js"></script>
  </body>
</html>
```

- [ ] **Step 9: Re-run the server integration test to confirm it now sees the real output page**

Run: `npm run build:output && npx vitest run tests/integration/server.test.ts tests/unit/output/render.test.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck, run the full test suite, and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/output vitest.config.ts
git commit -m "feat: add OBS output page with WebSocket live rendering and preset styles"
```

---

## Task 8: Electron Main Wiring + IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/preload.ts`
- Create: `src/shared/ipcChannels.ts`
- Create: `src/main/ipc/handlers.ts`
- Test: `tests/integration/ipcHandlers.test.ts`

**Interfaces:**
- Consumes: every repository from Tasks 3–4, `createServer`/`ServerHandle` (Task 6), `importOpenlpSongs`/`importOpenlpBible` (Task 5), `LiveState` type (Task 2).
- Produces: `IpcChannels` (channel name constants, in `src/shared/ipcChannels.ts`) and, from `src/main/ipc/handlers.ts`: `handleSetLiveState(db, server, mainWindow, stagedItemId, verseOrBlockId, styleId): LiveState`, `handleImportOpenlp(db, songsPath, biblePaths): ImportSummary`, `getServerUrls(port): { local: string; lan: string | null }`, and `registerIpcHandlers(db, server, mainWindow, port): void` — the renderer's `window.api` (exposed by `preload.ts`) is the only thing Tasks 9–11 depend on, and its method names/signatures are fixed here.

- [ ] **Step 1: Write `src/shared/ipcChannels.ts`**

```ts
export const IpcChannels = {
  FindBibleBooks: 'bible:find-books',
  GetChaptersForBook: 'bible:get-chapters',
  GetVersesForChapter: 'bible:get-verses',
  SearchBibleContent: 'bible:search-content',
  FindSongsByTitle: 'song:find-by-title',
  GetBlocksForSong: 'song:get-blocks',
  SearchSongContent: 'song:search-content',
  GetStagedItems: 'staged:get-all',
  StageItem: 'staged:add',
  UnstageItem: 'staged:remove',
  ReorderStagedItems: 'staged:reorder',
  GetLiveState: 'live:get',
  SetLiveState: 'live:set',
  GetOutputStyles: 'styles:get',
  SetActiveStyle: 'styles:set-active',
  GetServerUrls: 'server:get-urls',
  PickOpenlpFiles: 'openlp:pick-files',
  ImportOpenlp: 'openlp:import',
  LiveStateChanged: 'live:changed',
} as const;
```

- [ ] **Step 2: Write the failing IPC handlers test**

This tests the pure, exported handler functions directly (not through Electron's
`ipcMain`, which requires a running Electron process) — the same functions
`registerIpcHandlers` wires up in Step 4.

`tests/integration/ipcHandlers.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../src/main/db/schema';
import { seedDefaultOutputStyles } from '../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../src/main/db/stagedItemsRepository';
import { createServer, ServerHandle } from '../../src/main/server/server';
import { handleSetLiveState, handleImportOpenlp, getServerUrls } from '../../src/main/ipc/handlers';
import { IpcChannels } from '../../src/shared/ipcChannels';
import { createFixtureSongsDb } from '../helpers/openlpFixtures';

let db: Database.Database;
let server: ServerHandle;

beforeEach(async () => {
  db = new Database(':memory:');
  applySchema(db);
  seedDefaultOutputStyles(db);
  server = createServer(db);
  await server.start(0);
});

describe('handleSetLiveState', () => {
  it('persists live state, broadcasts to the server, and pushes to the renderer window', () => {
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const stagedItem = addStagedItem(db, 'song', 1, null);

    const result = handleSetLiveState(db, server, fakeWindow, stagedItem.id, 5, null);

    expect(result.stagedItemId).toBe(stagedItem.id);
    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(IpcChannels.LiveStateChanged, result);
  });
});

describe('handleImportOpenlp', () => {
  it('combines results from the songs importer', () => {
    const songsPath = createFixtureSongsDb([
      {
        title: 'Test Song',
        lyrics:
          '<?xml version="1.0"?><song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Line one]]></verse></lyrics></song>',
      },
    ]);

    const summary = handleImportOpenlp(db, songsPath, []);

    expect(summary.imported).toBe(1);
    expect(summary.errors).toHaveLength(0);
  });
});

describe('getServerUrls', () => {
  it('returns a localhost URL for the output page', () => {
    const urls = getServerUrls(4180);
    expect(urls.local).toBe('http://localhost:4180/output');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/ipcHandlers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/main/ipc/handlers.ts`**

```ts
import { ipcMain, dialog, BrowserWindow } from 'electron';
import os from 'os';
import Database from 'better-sqlite3';
import { IpcChannels } from '../../shared/ipcChannels';
import * as bibleRepo from '../db/bibleRepository';
import * as songRepo from '../db/songRepository';
import * as stagedRepo from '../db/stagedItemsRepository';
import * as liveRepo from '../db/liveStateRepository';
import * as stylesRepo from '../db/outputStylesRepository';
import { importOpenlpSongs } from '../import/openlpSongsImporter';
import { importOpenlpBible } from '../import/openlpBibleImporter';
import { ServerHandle } from '../server/server';
import { ContentType, ImportSummary, LiveState, StagedItemType } from '../../shared/types';

export function handleSetLiveState(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  stagedItemId: number | null,
  verseOrBlockId: number | null,
  styleId: number | null
): LiveState {
  const state = liveRepo.setLiveState(db, stagedItemId, verseOrBlockId, styleId);
  server.broadcastLiveUpdate();
  mainWindow.webContents.send(IpcChannels.LiveStateChanged, state);
  return state;
}

export function handleImportOpenlp(db: Database.Database, songsPath: string | null, biblePaths: string[]): ImportSummary {
  const combined: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  if (songsPath) {
    const result = importOpenlpSongs(db, songsPath);
    combined.imported += result.imported;
    combined.skipped += result.skipped;
    combined.errors.push(...result.errors);
  }
  for (const biblePath of biblePaths) {
    const result = importOpenlpBible(db, biblePath);
    combined.imported += result.imported;
    combined.skipped += result.skipped;
    combined.errors.push(...result.errors);
  }
  return combined;
}

export function getServerUrls(port: number): { local: string; lan: string | null } {
  const local = `http://localhost:${port}/output`;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return { local, lan: `http://${iface.address}:${port}/output` };
      }
    }
  }
  return { local, lan: null };
}

export function registerIpcHandlers(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  port: number
): void {
  ipcMain.handle(IpcChannels.FindBibleBooks, (_e, query: string) => bibleRepo.findBooksByName(db, query));
  ipcMain.handle(IpcChannels.GetChaptersForBook, (_e, bookId: number, translation: string) =>
    bibleRepo.getChaptersForBook(db, bookId, translation)
  );
  ipcMain.handle(IpcChannels.GetVersesForChapter, (_e, bookId: number, chapter: number, translation: string) =>
    bibleRepo.getVersesForChapter(db, bookId, chapter, translation)
  );
  ipcMain.handle(IpcChannels.SearchBibleContent, (_e, query: string, translation: string) =>
    bibleRepo.searchBibleContent(db, query, translation)
  );
  ipcMain.handle(IpcChannels.FindSongsByTitle, (_e, query: string) => songRepo.findSongsByTitle(db, query));
  ipcMain.handle(IpcChannels.GetBlocksForSong, (_e, songId: number) => songRepo.getBlocksForSong(db, songId));
  ipcMain.handle(IpcChannels.SearchSongContent, (_e, query: string) => songRepo.searchSongContent(db, query));
  ipcMain.handle(IpcChannels.GetStagedItems, () => stagedRepo.getStagedItems(db));
  ipcMain.handle(IpcChannels.StageItem, (_e, type: StagedItemType, refId: number, chapter: number | null) =>
    stagedRepo.addStagedItem(db, type, refId, chapter)
  );
  ipcMain.handle(IpcChannels.UnstageItem, (_e, id: number) => stagedRepo.removeStagedItem(db, id));
  ipcMain.handle(IpcChannels.ReorderStagedItems, (_e, orderedIds: number[]) => stagedRepo.reorderStagedItems(db, orderedIds));
  ipcMain.handle(IpcChannels.GetLiveState, () => liveRepo.getLiveState(db));
  ipcMain.handle(
    IpcChannels.SetLiveState,
    (_e, stagedItemId: number | null, verseOrBlockId: number | null, styleId: number | null) =>
      handleSetLiveState(db, server, mainWindow, stagedItemId, verseOrBlockId, styleId)
  );
  ipcMain.handle(IpcChannels.GetOutputStyles, (_e, contentType: ContentType) => stylesRepo.getStyles(db, contentType));
  ipcMain.handle(IpcChannels.SetActiveStyle, (_e, contentType: ContentType, styleId: number) =>
    stylesRepo.setActiveStyle(db, contentType, styleId)
  );
  ipcMain.handle(IpcChannels.GetServerUrls, () => getServerUrls(port));
  ipcMain.handle(IpcChannels.PickOpenlpFiles, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IpcChannels.ImportOpenlp, (_e, songsPath: string | null, biblePaths: string[]) =>
    handleImportOpenlp(db, songsPath, biblePaths)
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/ipcHandlers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Rewrite `src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { openDatabase } from './db/client';
import { seedDefaultOutputStyles } from './db/outputStylesRepository';
import { createServer } from './server/server';
import { registerIpcHandlers } from './ipc/handlers';

const DEFAULT_PORT = 4180;

async function createWindow() {
  const dbPath = path.join(app.getPath('userData'), 'serviceflow.db');
  const db = openDatabase(dbPath);
  seedDefaultOutputStyles(db);

  const server = createServer(db);
  let port: number;
  try {
    port = await server.start(DEFAULT_PORT);
  } catch (err) {
    dialog.showErrorBox(
      'ServiceFlow could not start its output server',
      `Port ${DEFAULT_PORT} is unavailable (${(err as Error).message}). ` +
        'Close whatever is using it, or change the port in Settings after relaunching.'
    );
    port = await server.start(0);
  }

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerIpcHandlers(db, server, mainWindow, port);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: Rewrite `src/main/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipcChannels';
import type { ContentType, LiveState, StagedItemType } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  findBibleBooks: (query: string) => ipcRenderer.invoke(IpcChannels.FindBibleBooks, query),
  getChaptersForBook: (bookId: number, translation: string) =>
    ipcRenderer.invoke(IpcChannels.GetChaptersForBook, bookId, translation),
  getVersesForChapter: (bookId: number, chapter: number, translation: string) =>
    ipcRenderer.invoke(IpcChannels.GetVersesForChapter, bookId, chapter, translation),
  searchBibleContent: (query: string, translation: string) =>
    ipcRenderer.invoke(IpcChannels.SearchBibleContent, query, translation),
  findSongsByTitle: (query: string) => ipcRenderer.invoke(IpcChannels.FindSongsByTitle, query),
  getBlocksForSong: (songId: number) => ipcRenderer.invoke(IpcChannels.GetBlocksForSong, songId),
  searchSongContent: (query: string) => ipcRenderer.invoke(IpcChannels.SearchSongContent, query),
  getStagedItems: () => ipcRenderer.invoke(IpcChannels.GetStagedItems),
  stageItem: (type: StagedItemType, refId: number, chapter: number | null) =>
    ipcRenderer.invoke(IpcChannels.StageItem, type, refId, chapter),
  unstageItem: (id: number) => ipcRenderer.invoke(IpcChannels.UnstageItem, id),
  reorderStagedItems: (orderedIds: number[]) => ipcRenderer.invoke(IpcChannels.ReorderStagedItems, orderedIds),
  getLiveState: () => ipcRenderer.invoke(IpcChannels.GetLiveState),
  setLiveState: (stagedItemId: number | null, verseOrBlockId: number | null, styleId: number | null) =>
    ipcRenderer.invoke(IpcChannels.SetLiveState, stagedItemId, verseOrBlockId, styleId),
  getOutputStyles: (contentType: ContentType) => ipcRenderer.invoke(IpcChannels.GetOutputStyles, contentType),
  setActiveStyle: (contentType: ContentType, styleId: number) =>
    ipcRenderer.invoke(IpcChannels.SetActiveStyle, contentType, styleId),
  getServerUrls: () => ipcRenderer.invoke(IpcChannels.GetServerUrls),
  pickOpenlpFiles: () => ipcRenderer.invoke(IpcChannels.PickOpenlpFiles),
  importOpenlp: (songsPath: string | null, biblePaths: string[]) =>
    ipcRenderer.invoke(IpcChannels.ImportOpenlp, songsPath, biblePaths),
  onLiveStateChanged: (callback: (state: LiveState) => void) => {
    const listener = (_event: unknown, state: LiveState) => callback(state);
    ipcRenderer.on(IpcChannels.LiveStateChanged, listener);
    return () => ipcRenderer.removeListener(IpcChannels.LiveStateChanged, listener);
  },
});
```

- [ ] **Step 8: Typecheck, run the full test suite, and manually verify the app still boots**

Run: `npm run typecheck && npm test`
Run: `npm run build:main && npm run dev`
Expected: the Electron window opens with no console errors about `window.api`.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipcChannels.ts src/main/ipc/handlers.ts src/main/index.ts src/main/preload.ts tests/integration/ipcHandlers.test.ts
git commit -m "feat: wire Electron main process, embedded server, and IPC API"
```

---

## Task 9: Renderer API Layer + Search Panel

**Files:**
- Create: `src/renderer/window.d.ts`
- Create: `src/renderer/components/SearchPanel.tsx`
- Test: `tests/component/SearchPanel.test.tsx`

**Interfaces:**
- Consumes: `window.api.*` methods exposed by `preload.ts` (Task 8); `BibleBook`, `BibleSearchResult`, `Song`, `SongSearchResult`, `StagedItemType` types (Task 2).
- Produces: the global `Window.api: ServiceFlowApi` type declaration (so every component can call `window.api.*` directly with full typing, no wrapper needed) and `<SearchPanel onStaged={() => void} />` — consumed by `App.tsx` in Task 11.

- [ ] **Step 1: Write `src/renderer/window.d.ts`**

```ts
import type { BibleBook, BibleSearchResult, ContentType, LiveState, OutputStyle, Song, SongBlock, SongSearchResult, StagedItem, StagedItemType, ImportSummary, BibleVerse } from '../shared/types';

export interface ServiceFlowApi {
  findBibleBooks(query: string): Promise<BibleBook[]>;
  getChaptersForBook(bookId: number, translation: string): Promise<number[]>;
  getVersesForChapter(bookId: number, chapter: number, translation: string): Promise<BibleVerse[]>;
  searchBibleContent(query: string, translation: string): Promise<BibleSearchResult[]>;
  findSongsByTitle(query: string): Promise<Song[]>;
  getBlocksForSong(songId: number): Promise<SongBlock[]>;
  searchSongContent(query: string): Promise<SongSearchResult[]>;
  getStagedItems(): Promise<StagedItem[]>;
  stageItem(type: StagedItemType, refId: number, chapter: number | null): Promise<StagedItem>;
  unstageItem(id: number): Promise<void>;
  reorderStagedItems(orderedIds: number[]): Promise<void>;
  getLiveState(): Promise<LiveState>;
  setLiveState(stagedItemId: number | null, verseOrBlockId: number | null, styleId: number | null): Promise<LiveState>;
  getOutputStyles(contentType: ContentType): Promise<OutputStyle[]>;
  setActiveStyle(contentType: ContentType, styleId: number): Promise<void>;
  getServerUrls(): Promise<{ local: string; lan: string | null }>;
  pickOpenlpFiles(): Promise<string[]>;
  importOpenlp(songsPath: string | null, biblePaths: string[]): Promise<ImportSummary>;
  onLiveStateChanged(callback: (state: LiveState) => void): () => void;
}

declare global {
  interface Window {
    api: ServiceFlowApi;
  }
}
```

- [ ] **Step 2: Write the failing SearchPanel test**

`tests/component/SearchPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchPanel from '../../src/renderer/components/SearchPanel';

beforeEach(() => {
  (window as any).api = {
    findBibleBooks: vi.fn().mockResolvedValue([{ id: 43, name: 'John', testament: 'NT', sortOrder: 43 }]),
    getChaptersForBook: vi.fn().mockResolvedValue([1, 2, 3]),
    searchBibleContent: vi.fn().mockResolvedValue([]),
    findSongsByTitle: vi.fn().mockResolvedValue([{ id: 1, title: 'Amazing Grace', ccliNumber: null }]),
    searchSongContent: vi.fn().mockResolvedValue([]),
    stageItem: vi.fn().mockResolvedValue({ id: 1, type: 'bible', refId: 43, chapter: 3, position: 0, label: 'John 3' }),
  };
});

describe('SearchPanel', () => {
  it('searches bible books by typed name and stages a chapter on click', async () => {
    const onStaged = vi.fn();
    render(<SearchPanel onStaged={onStaged} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'joh' } });
    await waitFor(() => expect(window.api.findBibleBooks).toHaveBeenCalledWith('joh'));

    fireEvent.click(await screen.findByText('John'));
    fireEvent.click(await screen.findByText('3'));

    await waitFor(() => expect(window.api.stageItem).toHaveBeenCalledWith('bible', 43, 3));
    expect(onStaged).toHaveBeenCalled();
  });

  it('switches to song mode and stages a song by title', async () => {
    (window.api.stageItem as any).mockResolvedValue({ id: 2, type: 'song', refId: 1, chapter: null, position: 0, label: 'Amazing Grace' });
    const onStaged = vi.fn();
    render(<SearchPanel onStaged={onStaged} />);

    fireEvent.click(screen.getByRole('button', { name: /songs/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'amaz' } });
    await waitFor(() => expect(window.api.findSongsByTitle).toHaveBeenCalledWith('amaz'));

    fireEvent.click(await screen.findByText('Amazing Grace'));

    await waitFor(() => expect(window.api.stageItem).toHaveBeenCalledWith('song', 1, null));
    expect(onStaged).toHaveBeenCalled();
  });

  it('shows a "no matches" state when content search returns nothing', async () => {
    render(<SearchPanel onStaged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /content search/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz' } });

    await waitFor(() => expect(window.api.searchBibleContent).toHaveBeenCalledWith('zzz', 'KJV'));
    expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/component/SearchPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/renderer/components/SearchPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { BibleBook } from '../../shared/types';

type Mode = 'bible' | 'song';
type SubMode = 'browse' | 'content';
const TRANSLATION = 'KJV';

interface Props {
  onStaged: () => void;
}

export default function SearchPanel({ onStaged }: Props) {
  const [mode, setMode] = useState<Mode>('bible');
  const [subMode, setSubMode] = useState<SubMode>('browse');
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [songs, setSongs] = useState<{ id: number; title: string }[]>([]);
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [chapters, setChapters] = useState<number[]>([]);
  const [contentResults, setContentResults] = useState<{ label: string; onSelect: () => void }[]>([]);

  useEffect(() => {
    setSelectedBook(null);
    setChapters([]);
    setContentResults([]);
    if (query.trim() === '') {
      setBooks([]);
      setSongs([]);
      return;
    }
    if (subMode === 'browse' && mode === 'bible') {
      window.api.findBibleBooks(query).then(setBooks);
    } else if (subMode === 'browse' && mode === 'song') {
      window.api.findSongsByTitle(query).then(setSongs);
    } else if (subMode === 'content' && mode === 'bible') {
      window.api.searchBibleContent(query, TRANSLATION).then((results) =>
        setContentResults(
          results.map((r) => ({
            label: `${r.bookName} ${r.verse.chapter}:${r.verse.verse} — ${r.verse.text}`,
            onSelect: () => window.api.stageItem('bible', r.verse.bookId, r.verse.chapter).then(onStaged),
          }))
        )
      );
    } else {
      window.api.searchSongContent(query).then((results) =>
        setContentResults(
          results.map((r) => ({
            label: `${r.songTitle} (${r.block.label}) — ${r.block.text}`,
            onSelect: () => window.api.stageItem('song', r.block.songId, null).then(onStaged),
          }))
        )
      );
    }
  }, [query, mode, subMode]);

  async function selectBook(book: BibleBook) {
    setSelectedBook(book);
    setChapters(await window.api.getChaptersForBook(book.id, TRANSLATION));
  }

  return (
    <div>
      <div>
        <button onClick={() => { setMode('bible'); setQuery(''); }} aria-pressed={mode === 'bible'}>
          Bible
        </button>
        <button onClick={() => { setMode('song'); setQuery(''); }} aria-pressed={mode === 'song'}>
          Songs
        </button>
      </div>
      <div>
        <button onClick={() => { setSubMode('browse'); setQuery(''); }} aria-pressed={subMode === 'browse'}>
          Browse
        </button>
        <button onClick={() => { setSubMode('content'); setQuery(''); }} aria-pressed={subMode === 'content'}>
          Content search
        </button>
      </div>
      <input
        id="search-input"
        placeholder={mode === 'bible' ? 'Search book name or content...' : 'Search song title or lyrics...'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {subMode === 'browse' && mode === 'bible' && !selectedBook && (
        <ul>
          {books.length === 0 && query.trim() !== '' && <li>No matches</li>}
          {books.map((b) => (
            <li key={b.id}>
              <button onClick={() => selectBook(b)}>{b.name}</button>
            </li>
          ))}
        </ul>
      )}
      {subMode === 'browse' && mode === 'bible' && selectedBook && (
        <ul>
          {chapters.map((c) => (
            <li key={c}>
              <button onClick={() => window.api.stageItem('bible', selectedBook.id, c).then(onStaged)}>{c}</button>
            </li>
          ))}
        </ul>
      )}
      {subMode === 'browse' && mode === 'song' && (
        <ul>
          {songs.length === 0 && query.trim() !== '' && <li>No matches</li>}
          {songs.map((s) => (
            <li key={s.id}>
              <button onClick={() => window.api.stageItem('song', s.id, null).then(onStaged)}>{s.title}</button>
            </li>
          ))}
        </ul>
      )}
      {subMode === 'content' && (
        <ul>
          {contentResults.length === 0 && query.trim() !== '' && <li>No matches</li>}
          {contentResults.map((r, i) => (
            <li key={i}>
              <button onClick={r.onSelect}>{r.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/component/SearchPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/renderer/window.d.ts src/renderer/components/SearchPanel.tsx tests/component/SearchPanel.test.tsx
git commit -m "feat: add typed window.api declaration and search panel (browse + content search)"
```

---

## Task 10: Staged List, Content Pane, and Live Banner

**Files:**
- Create: `src/renderer/components/StagedList.tsx`
- Create: `src/renderer/components/ContentPane.tsx`
- Create: `src/renderer/components/LiveBanner.tsx`
- Test: `tests/component/StagedList.test.tsx`
- Test: `tests/component/ContentPane.test.tsx`

**Interfaces:**
- Consumes: `window.api.getStagedItems/unstageItem/reorderStagedItems/getVersesForChapter/getBlocksForSong/setLiveState/onLiveStateChanged` (Task 8/9); `StagedItem`, `BibleVerse`, `SongBlock`, `LiveState` types (Task 2).
- Produces: `<StagedList items refreshToken onSelectActive={(item: StagedItem) => void} />`, `<ContentPane activeItem={StagedItem | null} liveState={LiveState} onLive={() => void} />`, `<LiveBanner liveState={LiveState} />` — all consumed by `App.tsx` in Task 11.

- [ ] **Step 1: Write the failing StagedList test**

`tests/component/StagedList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StagedList from '../../src/renderer/components/StagedList';

const items = [
  { id: 1, type: 'bible' as const, refId: 43, chapter: 3, position: 0, label: 'John 3' },
  { id: 2, type: 'song' as const, refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
];

beforeEach(() => {
  (window as any).api = {
    unstageItem: vi.fn().mockResolvedValue(undefined),
    reorderStagedItems: vi.fn().mockResolvedValue(undefined),
  };
});

describe('StagedList', () => {
  it('renders every staged item label', () => {
    render(<StagedList items={items} onSelectActive={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText('John 3')).toBeInTheDocument();
    expect(screen.getByText('Amazing Grace')).toBeInTheDocument();
  });

  it('calls onSelectActive when an item is clicked', () => {
    const onSelectActive = vi.fn();
    render(<StagedList items={items} onSelectActive={onSelectActive} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('John 3'));
    expect(onSelectActive).toHaveBeenCalledWith(items[0]);
  });

  it('unstages an item when its remove button is clicked', async () => {
    const onChanged = vi.fn();
    render(<StagedList items={items} onSelectActive={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    await waitFor(() => expect(window.api.unstageItem).toHaveBeenCalledWith(1));
    expect(onChanged).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing ContentPane test**

`tests/component/ContentPane.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContentPane from '../../src/renderer/components/ContentPane';

const bibleItem = { id: 1, type: 'bible' as const, refId: 43, chapter: 3, position: 0, label: 'John 3' };
const liveState = { stagedItemId: null, verseOrBlockId: null, styleId: null, updatedAt: '' };

beforeEach(() => {
  (window as any).api = {
    getVersesForChapter: vi.fn().mockResolvedValue([
      { id: 100, bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world.', translation: 'KJV' },
      { id: 101, bookId: 43, chapter: 3, verse: 17, text: 'For God sent not his Son to condemn.', translation: 'KJV' },
    ]),
    setLiveState: vi.fn().mockResolvedValue({}),
  };
});

describe('ContentPane', () => {
  it('lists verses for the active bible item', async () => {
    render(<ContentPane activeItem={bibleItem} liveState={liveState} onLive={vi.fn()} />);
    expect(await screen.findByText(/For God so loved the world/)).toBeInTheDocument();
    expect(await screen.findByText(/For God sent not his Son/)).toBeInTheDocument();
  });

  it('sets live state when a verse is clicked', async () => {
    const onLive = vi.fn();
    render(<ContentPane activeItem={bibleItem} liveState={liveState} onLive={onLive} />);
    fireEvent.click(await screen.findByText(/For God so loved the world/));
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 100, null));
    expect(onLive).toHaveBeenCalled();
  });

  it('moves live to the next verse on ArrowDown when a verse is already live', async () => {
    const liveOnFirst = { stagedItemId: 1, verseOrBlockId: 100, styleId: null, updatedAt: '' };
    render(<ContentPane activeItem={bibleItem} liveState={liveOnFirst} onLive={vi.fn()} />);
    await screen.findByText(/For God so loved the world/);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 101, null));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/component/StagedList.test.tsx tests/component/ContentPane.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/renderer/components/StagedList.tsx`**

```tsx
import type { StagedItem } from '../../shared/types';

interface Props {
  items: StagedItem[];
  onSelectActive: (item: StagedItem) => void;
  onChanged: () => void;
}

export default function StagedList({ items, onSelectActive, onChanged }: Props) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <button onClick={() => onSelectActive(item)}>{item.label}</button>
          <button
            aria-label={`Remove ${item.label}`}
            onClick={() => window.api.unstageItem(item.id).then(onChanged)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Write `src/renderer/components/ContentPane.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { BibleVerse, LiveState, SongBlock, StagedItem } from '../../shared/types';

const TRANSLATION = 'KJV';

interface Props {
  activeItem: StagedItem | null;
  liveState: LiveState;
  onLive: () => void;
}

export default function ContentPane({ activeItem, liveState, onLive }: Props) {
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [blocks, setBlocks] = useState<SongBlock[]>([]);

  useEffect(() => {
    if (!activeItem) {
      setVerses([]);
      setBlocks([]);
      return;
    }
    if (activeItem.type === 'bible' && activeItem.chapter != null) {
      window.api.getVersesForChapter(activeItem.refId, activeItem.chapter, TRANSLATION).then(setVerses);
      setBlocks([]);
    } else if (activeItem.type === 'song') {
      window.api.getBlocksForSong(activeItem.refId).then(setBlocks);
      setVerses([]);
    }
  }, [activeItem]);

  function goLive(id: number) {
    if (!activeItem) return;
    window.api.setLiveState(activeItem.id, id, null).then(onLive);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!activeItem || liveState.stagedItemId !== activeItem.id || liveState.verseOrBlockId == null) return;
      const list = activeItem.type === 'bible' ? verses : blocks;
      const index = list.findIndex((entry) => entry.id === liveState.verseOrBlockId);
      if (index === -1) return;
      if (e.key === 'ArrowDown' && index < list.length - 1) goLive(list[index + 1].id);
      if (e.key === 'ArrowUp' && index > 0) goLive(list[index - 1].id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeItem, liveState, verses, blocks]);

  if (!activeItem) return <div>No item selected</div>;

  const isLiveId = (id: number) => liveState.stagedItemId === activeItem.id && liveState.verseOrBlockId === id;

  if (activeItem.type === 'bible') {
    return (
      <ul>
        {verses.map((v) => (
          <li key={v.id}>
            <button onClick={() => goLive(v.id)} aria-pressed={isLiveId(v.id)}>
              {v.verse}. {v.text}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul>
      {blocks.map((b) => (
        <li key={b.id}>
          <button onClick={() => goLive(b.id)} aria-pressed={isLiveId(b.id)}>
            {b.label}: {b.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/component/StagedList.test.tsx tests/component/ContentPane.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 7: Write `src/renderer/components/LiveBanner.tsx`** (no test — trivial presentational component; covered indirectly by the App smoke test in Task 11)

```tsx
import { useEffect, useState } from 'react';
import type { LiveState } from '../../shared/types';

interface Props {
  liveState: LiveState;
}

export default function LiveBanner({ liveState }: Props) {
  const [label, setLabel] = useState<string>('Nothing live');

  useEffect(() => {
    if (liveState.stagedItemId == null || liveState.verseOrBlockId == null) {
      setLabel('Nothing live');
      return;
    }
    setLabel(`LIVE (item #${liveState.stagedItemId}, entry #${liveState.verseOrBlockId})`);
  }, [liveState]);

  return <div role="status">{label}</div>;
}
```

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck && npm test`

```bash
git add src/renderer/components/StagedList.tsx src/renderer/components/ContentPane.tsx src/renderer/components/LiveBanner.tsx tests/component/StagedList.test.tsx tests/component/ContentPane.test.tsx
git commit -m "feat: add staged list, content pane with arrow-key live navigation, and live banner"
```

---

## Task 11: Settings Screen + App Shell

**Files:**
- Create: `src/renderer/components/SettingsScreen.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `tests/component/SettingsScreen.test.tsx`
- Test: `tests/component/App.test.tsx`

**Interfaces:**
- Consumes: `window.api.getServerUrls/getOutputStyles/setActiveStyle/pickOpenlpFiles/importOpenlp` (Task 8); `SearchPanel`, `StagedList`, `ContentPane`, `LiveBanner` (Tasks 9–10); the `#search-input` element id `SearchPanel` renders (Task 9).
- Produces: `<SettingsScreen />`, and the final composed `<App />` — the top-level component `main.tsx` (Task 1) renders. `App` also owns the spec's global keyboard shortcuts: digit keys `1`-`9` jump directly to a staged item's content pane, and `/` or `Ctrl+F` focuses the search box.

- [ ] **Step 1: Write the failing SettingsScreen test**

`tests/component/SettingsScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsScreen from '../../src/renderer/components/SettingsScreen';

beforeEach(() => {
  (window as any).api = {
    getServerUrls: vi.fn().mockResolvedValue({ local: 'http://localhost:4180/output', lan: 'http://192.168.1.20:4180/output' }),
    getOutputStyles: vi.fn().mockImplementation((contentType: string) =>
      Promise.resolve([
        { id: 1, contentType, name: 'Classic Lower Third', templateKey: `${contentType}-classic`, settings: {}, isActive: true },
        { id: 2, contentType, name: 'Minimal Caption', templateKey: `${contentType}-minimal`, settings: {}, isActive: false },
      ])
    ),
    setActiveStyle: vi.fn().mockResolvedValue(undefined),
    pickOpenlpFiles: vi.fn().mockResolvedValue(['/path/to/songs.sqlite']),
    importOpenlp: vi.fn().mockResolvedValue({ imported: 556, skipped: 0, errors: [] }),
  };
});

describe('SettingsScreen', () => {
  it('shows the local and LAN output URLs', async () => {
    render(<SettingsScreen />);
    expect(await screen.findByText('http://localhost:4180/output')).toBeInTheDocument();
    expect(await screen.findByText('http://192.168.1.20:4180/output')).toBeInTheDocument();
  });

  it('sets the active bible style independently from the song style', async () => {
    render(<SettingsScreen />);
    const bibleMinimal = await screen.findByRole('button', { name: /bible.*minimal caption/i });
    fireEvent.click(bibleMinimal);
    await waitFor(() => expect(window.api.setActiveStyle).toHaveBeenCalledWith('bible', 2));
  });

  it('runs an OpenLP import and shows the resulting summary', async () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /import from openlp/i }));
    await waitFor(() => expect(window.api.importOpenlp).toHaveBeenCalled());
    expect(await screen.findByText(/556 imported/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/component/SettingsScreen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/renderer/components/SettingsScreen.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { ContentType, ImportSummary, OutputStyle } from '../../shared/types';

export default function SettingsScreen() {
  const [urls, setUrls] = useState<{ local: string; lan: string | null } | null>(null);
  const [bibleStyles, setBibleStyles] = useState<OutputStyle[]>([]);
  const [songStyles, setSongStyles] = useState<OutputStyle[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    window.api.getServerUrls().then(setUrls);
    window.api.getOutputStyles('bible').then(setBibleStyles);
    window.api.getOutputStyles('song').then(setSongStyles);
  }, []);

  async function chooseStyle(contentType: ContentType, styleId: number) {
    await window.api.setActiveStyle(contentType, styleId);
    if (contentType === 'bible') setBibleStyles(await window.api.getOutputStyles('bible'));
    else setSongStyles(await window.api.getOutputStyles('song'));
  }

  async function runImport() {
    const files = await window.api.pickOpenlpFiles();
    if (files.length === 0) return;
    const songsPath = files.find((f) => f.toLowerCase().includes('song')) ?? null;
    const biblePaths = files.filter((f) => f !== songsPath);
    setSummary(await window.api.importOpenlp(songsPath, biblePaths));
  }

  function styleSection(contentType: ContentType, styles: OutputStyle[]) {
    return (
      <div>
        <h3>{contentType === 'bible' ? 'Bible style' : 'Song style'}</h3>
        {styles.map((s) => (
          <button
            key={s.id}
            aria-pressed={s.isActive}
            aria-label={`${contentType} ${s.name}`}
            onClick={() => chooseStyle(contentType, s.id)}
          >
            {s.name} {s.isActive ? '(active)' : ''}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2>Settings</h2>
      <section>
        <h3>OBS Browser Source URLs</h3>
        {urls && (
          <ul>
            <li>Same computer: {urls.local}</li>
            {urls.lan && <li>Same network (other computer): {urls.lan}</li>}
          </ul>
        )}
        <p>
          In OBS: Sources → + → Browser Source → paste one of the URLs above → set width/height to your stream
          resolution → check "Shutdown source when not visible" off.
        </p>
      </section>
      {styleSection('bible', bibleStyles)}
      {styleSection('song', songStyles)}
      <section>
        <h3>Import from OpenLP</h3>
        <button onClick={runImport}>Import from OpenLP</button>
        {summary && (
          <p>
            {summary.imported} imported, {summary.skipped} skipped.
            {summary.errors.length > 0 && ` Errors: ${summary.errors.map((e) => e.identifier).join(', ')}`}
          </p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/component/SettingsScreen.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing App smoke test**

`tests/component/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../../src/renderer/App';

beforeEach(() => {
  (window as any).api = {
    getStagedItems: vi.fn().mockResolvedValue([]),
    getLiveState: vi.fn().mockResolvedValue({ stagedItemId: null, verseOrBlockId: null, styleId: null, updatedAt: '' }),
    onLiveStateChanged: vi.fn().mockReturnValue(() => {}),
    getServerUrls: vi.fn().mockResolvedValue({ local: 'http://localhost:4180/output', lan: null }),
    getOutputStyles: vi.fn().mockResolvedValue([]),
    findBibleBooks: vi.fn().mockResolvedValue([]),
    findSongsByTitle: vi.fn().mockResolvedValue([]),
  };
});

describe('App', () => {
  it('renders the operator view with search, staged list, and live banner', async () => {
    render(<App />);
    expect(await screen.findByText(/nothing live/i)).toBeInTheDocument();
    expect(screen.getByText('Bible')).toBeInTheDocument();
    expect(screen.getByText('Songs')).toBeInTheDocument();
  });

  it('switches to the settings view', async () => {
    render(<App />);
    screen.getByRole('button', { name: /settings/i }).click();
    expect(await screen.findByText(/OBS Browser Source URLs/i)).toBeInTheDocument();
  });

  it('focuses the search box when "/" is pressed', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText(/search/i);
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(window, { key: '/' });
    expect(input).toHaveFocus();
  });

  it('jumps to a staged item\'s content pane when its number key is pressed', async () => {
    (window.api.getStagedItems as any).mockResolvedValue([
      { id: 1, type: 'bible', refId: 43, chapter: 3, position: 0, label: 'John 3' },
      { id: 2, type: 'song', refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
    ]);
    (window.api.getBlocksForSong as any) = vi.fn().mockResolvedValue([
      { id: 200, songId: 1, label: 'Verse 1', text: 'Amazing grace', displayOrder: 0 },
    ]);
    render(<App />);
    await screen.findByText('John 3');

    fireEvent.keyDown(window, { key: '2' });

    expect(await screen.findByText(/Amazing grace/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/component/App.test.tsx`
Expected: FAIL — `App` does not yet render this content.

- [ ] **Step 7: Rewrite `src/renderer/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import SearchPanel from './components/SearchPanel';
import StagedList from './components/StagedList';
import ContentPane from './components/ContentPane';
import LiveBanner from './components/LiveBanner';
import SettingsScreen from './components/SettingsScreen';
import type { LiveState, StagedItem } from '../shared/types';

const EMPTY_LIVE_STATE: LiveState = { stagedItemId: null, verseOrBlockId: null, styleId: null, updatedAt: '' };

export default function App() {
  const [view, setView] = useState<'operate' | 'settings'>('operate');
  const [items, setItems] = useState<StagedItem[]>([]);
  const [activeItem, setActiveItem] = useState<StagedItem | null>(null);
  const [liveState, setLiveStateValue] = useState<LiveState>(EMPTY_LIVE_STATE);

  const refreshStagedItems = useCallback(() => {
    window.api.getStagedItems().then(setItems);
  }, []);

  useEffect(() => {
    refreshStagedItems();
    window.api.getLiveState().then(setLiveStateValue);
    const unsubscribe = window.api.onLiveStateChanged(setLiveStateValue);
    return unsubscribe;
  }, [refreshStagedItems]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTypingInField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (e.key === '/' || (e.key.toLowerCase() === 'f' && e.ctrlKey)) {
        if (!isTypingInField) {
          e.preventDefault();
          document.getElementById('search-input')?.focus();
        }
        return;
      }

      if (!isTypingInField && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1;
        if (items[index]) {
          setView('operate');
          setActiveItem(items[index]);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items]);

  return (
    <div>
      <nav>
        <button onClick={() => setView('operate')}>Operate</button>
        <button onClick={() => setView('settings')}>Settings</button>
      </nav>
      <LiveBanner liveState={liveState} />
      {view === 'settings' ? (
        <SettingsScreen />
      ) : (
        <div>
          <SearchPanel onStaged={refreshStagedItems} />
          <StagedList items={items} onSelectActive={setActiveItem} onChanged={refreshStagedItems} />
          <ContentPane activeItem={activeItem} liveState={liveState} onLive={() => window.api.getLiveState().then(setLiveStateValue)} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/component/App.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck, run the full suite, and manually verify in the running app**

Run: `npm run typecheck && npm test`
Run: `npm run build:main && npm run dev`

Manually: use Settings → Import from OpenLP, pick the church's real `openlp/songs.sqlite`
and `openlp/KJV.sqlite` (these live untracked at the repo root — see Global Constraints),
confirm the summary shows ~556 songs and ~36,503 verses imported with 0 errors, then
switch to Operate, search "John", stage chapter 3, click verse 16, and confirm the live
banner updates.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/SettingsScreen.tsx src/renderer/App.tsx tests/component/SettingsScreen.test.tsx tests/component/App.test.tsx
git commit -m "feat: add settings screen (URLs, per-content-type styles, OpenLP import) and compose App shell"
```

---

## Task 12: Packaging

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` (add `build` config reference, already scripted in Task 1)

**Interfaces:**
- Consumes: `dist/main`, `dist/renderer`, `dist/output` (Tasks 1, 7, 8) as the build output `electron-builder` packages.
- Produces: a Windows NSIS installer under `release/`.

- [ ] **Step 1: Write `electron-builder.yml`**

```yaml
appId: com.serviceflow.app
productName: ServiceFlow
directories:
  output: release
  buildResources: build
files:
  - dist/**/*
  - package.json
asarUnpack:
  - '**/*.node'
win:
  target: nsis
  artifactName: '${productName}-Setup-${version}.${ext}'
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
```

- [ ] **Step 2: Add a minimal `build/icon.ico` placeholder note**

`electron-builder` requires a Windows icon for a polished installer; without one it falls
back to Electron's default. Create `build/` and drop in a real church-branded `.ico` before
the first real release — not required for this task's build to succeed, so leave a note
rather than fabricate a fake icon:

```bash
mkdir -p build
```

(No icon file is committed here — add `build/icon.ico` manually when branding is ready;
`electron-builder` works without it in the meantime.)

- [ ] **Step 3: Run the packaging build**

Run: `npm run package`
Expected: `release/ServiceFlow-Setup-0.1.0.exe` is created. If `better-sqlite3`'s native
binding fails to load when the packaged app launches, re-run `npm run postinstall` (the
`electron-rebuild` script from Task 1) before packaging again — this rebuilds the native
module against Electron's Node ABI rather than the system Node ABI.

- [ ] **Step 4: Manually verify the installer on a Windows machine**

Since this repository was developed on Linux/WSL, `npm run package` cross-builds the
Windows installer but cannot be launched here. Copy `release/ServiceFlow-Setup-0.1.0.exe`
to the actual church Windows PC and confirm: it installs, launches, the OpenLP import
works against the real `openlp/` files, and the `/output` URL from Settings works as an
OBS Browser Source with a transparent background.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml
git commit -m "chore: configure electron-builder for Windows NSIS packaging"
```

---

## Known gaps versus the spec (not blocking v1, but real)

- **No visible banner on database write failure.** The spec calls for any DB write
  failure (disk full, permissions) to surface as a visible banner in the operator UI.
  This plan's IPC calls (`stageItem`, `setLiveState`, etc.) do not currently wrap
  failures in a shared error-banner mechanism — a failure would currently only appear
  as a rejected promise in the renderer devtools console. Before relying on this for a
  real service, add a small shared error-toast component and a `.catch()` on every
  `window.api.*` call site that surfaces the message there.
- **No manual server-port override**, per the deviation noted in Global Constraints —
  the app auto-picks a free port instead.

## Post-plan manual verification (not a task — do this before first live use)

Per the spec's testing strategy, these cannot be automated and must be checked by hand
with real OBS running before the app is trusted in an actual service:

1. Add a Browser Source in OBS pointed at the Settings-screen URL; confirm the background
   is transparent over a camera source.
2. If operator and OBS are on separate machines, confirm the LAN URL works end-to-end.
3. Kill the ServiceFlow process mid-session (staged items + a live verse set), relaunch,
   and confirm both the staged list and the live output are restored exactly.
4. Run the real OpenLP import against `openlp/songs.sqlite`, `openlp/KJV.sqlite`,
   `openlp/New English Translation (NET).sqlite`, and `openlp/New King James Version
   (NKJV).sqlite`, and spot-check a handful of songs and verses for correct text.
