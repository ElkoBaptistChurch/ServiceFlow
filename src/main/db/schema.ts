import Database from 'better-sqlite3';
import { normalizeForSearch } from './fts';

// The baseline schema. ServiceFlow is pre-release, so this is rewritten in place rather
// than migrated (D12); `user_version` and the MIGRATIONS list below stay for the first
// post-release change.
const BASELINE_SCHEMA_SQL = `
-- A translation is identified by a short code ('KJV'), whatever source supplied it:
-- the bundled resource, an OpenLP file, or a future format. Importing the same code
-- again updates it in place (D5: upsert, never delete).
CREATE TABLE IF NOT EXISTS bible_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bundled','openlp','file')),
  license_note TEXT,
  updated_at TEXT NOT NULL
);

-- Books are keyed by canonical USFM code (src/shared/bibleBooks.ts), never by a
-- source file's own book numbering -- OpenLP's ids differ between files (KJV's 44 is
-- Romans, NET's 44 is Acts). testament and sort_order always come from the canonical
-- list, so every translation orders and groups its books identically. Everything
-- downstream references this table's surrogate id, so a verse can never be captioned
-- with another translation's book name.
CREATE TABLE IF NOT EXISTS bible_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  translation_id INTEGER NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
  book_code TEXT NOT NULL,
  name TEXT NOT NULL,
  testament TEXT NOT NULL CHECK (testament IN ('OT','NT','AP')),
  sort_order INTEGER NOT NULL,
  UNIQUE(translation_id, book_code)
);
CREATE INDEX IF NOT EXISTS idx_bible_books_translation ON bible_books(translation_id, sort_order);

CREATE TABLE IF NOT EXISTS bible_verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES bible_books(id) ON DELETE CASCADE,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(book_id, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_bible_verses_lookup ON bible_verses(book_id, chapter);

CREATE VIRTUAL TABLE IF NOT EXISTS bible_verses_fts USING fts5(
  text, content='bible_verses', content_rowid='id', tokenize='porter'
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  ccli_number TEXT
);

-- Keyed by display_order, NOT by label: real songs repeat a (type, label) pair
-- ("How Sweet the name of Jesus Sounds" has six blocks and three distinct labels),
-- and keying on the label silently drops half the hymn.
CREATE TABLE IF NOT EXISTS song_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  UNIQUE(song_id, display_order)
);
CREATE INDEX IF NOT EXISTS idx_song_blocks_song ON song_blocks(song_id, display_order);

CREATE VIRTUAL TABLE IF NOT EXISTS song_blocks_fts USING fts5(
  text, content='song_blocks', content_rowid='id', tokenize='porter'
);

-- ref_id is polymorphic across bible_books/songs ids, so it can't carry a real FK;
-- deleting content unstages its items by hand (see the delete handlers in ipc/handlers).
CREATE TABLE IF NOT EXISTS staged_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('bible','song')),
  ref_id INTEGER NOT NULL,
  chapter INTEGER,
  position INTEGER NOT NULL
);

-- D-04: staged_item_id has a real FK so deleting the live staged item can't leave the
-- pointer dangling.
CREATE TABLE IF NOT EXISTS live_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  staged_item_id INTEGER REFERENCES staged_items(id) ON DELETE SET NULL,
  verse_or_block_id INTEGER,
  style_id INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS output_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL CHECK (content_type IN ('bible','song')),
  name TEXT NOT NULL,
  template_key TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 0
);

-- D-09: the FTS indexes are kept in sync by triggers rather than by every write path
-- remembering to do it by hand -- a cascaded delete (translation -> books -> verses,
-- or songs -> song_blocks) would otherwise silently orphan FTS rows. The 'delete' +
-- insert pair on UPDATE is the documented pattern for FTS5 external-content tables.
-- Text goes through normalize_for_search, registered as a SQL function in applySchema.
CREATE TRIGGER IF NOT EXISTS song_blocks_fts_ai AFTER INSERT ON song_blocks BEGIN
  INSERT INTO song_blocks_fts(rowid, text) VALUES (new.id, normalize_for_search(new.text));
END;
CREATE TRIGGER IF NOT EXISTS song_blocks_fts_ad AFTER DELETE ON song_blocks BEGIN
  INSERT INTO song_blocks_fts(song_blocks_fts, rowid, text) VALUES ('delete', old.id, normalize_for_search(old.text));
END;
CREATE TRIGGER IF NOT EXISTS song_blocks_fts_au AFTER UPDATE ON song_blocks BEGIN
  INSERT INTO song_blocks_fts(song_blocks_fts, rowid, text) VALUES ('delete', old.id, normalize_for_search(old.text));
  INSERT INTO song_blocks_fts(rowid, text) VALUES (new.id, normalize_for_search(new.text));
END;
CREATE TRIGGER IF NOT EXISTS bible_verses_fts_ai AFTER INSERT ON bible_verses BEGIN
  INSERT INTO bible_verses_fts(rowid, text) VALUES (new.id, normalize_for_search(new.text));
END;
CREATE TRIGGER IF NOT EXISTS bible_verses_fts_ad AFTER DELETE ON bible_verses BEGIN
  INSERT INTO bible_verses_fts(bible_verses_fts, rowid, text) VALUES ('delete', old.id, normalize_for_search(old.text));
END;
CREATE TRIGGER IF NOT EXISTS bible_verses_fts_au AFTER UPDATE ON bible_verses BEGIN
  INSERT INTO bible_verses_fts(bible_verses_fts, rowid, text) VALUES ('delete', old.id, normalize_for_search(old.text));
  INSERT INTO bible_verses_fts(rowid, text) VALUES (new.id, normalize_for_search(new.text));
END;
`;

interface Migration {
  version: number;
  up(db: Database.Database): void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(BASELINE_SCHEMA_SQL);
      db.prepare(`INSERT OR IGNORE INTO live_state (id, updated_at) VALUES (1, ?)`).run(new Date().toISOString());
    },
  },
];

/** The schema version a fully migrated database reports. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Keyed on PRAGMA user_version so an existing install only ever runs the steps it's
// missing; a fresh database runs every step in order. Each step commits its own
// user_version bump so a crash mid-migration resumes cleanly rather than re-running
// steps that already landed.
export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  // Backs the FTS sync triggers. Registered on every connection since
  // custom SQL functions aren't persisted in the database file itself.
  db.function('normalize_for_search', normalizeForSearch);
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    // Pre-release builds rewrote the schema in place (D12) instead of migrating it, so a
    // database from an older pre-release build can't be opened. Say so plainly -- the
    // startup error dialog (D9) shows this message -- rather than failing later on a
    // missing column.
    throw new Error(
      `This ServiceFlow database (schema version ${current}) was created by an older pre-release ` +
        `build and can't be opened by this one (schema version ${SCHEMA_VERSION}). ` +
        'Delete serviceflow.db from the ServiceFlow data folder and start again.'
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
