import Database from 'better-sqlite3';
import { normalizeForSearch } from './fts';

// Migration 1 — the baseline schema. `live_state` intentionally has no foreign key here;
// that arrives in migration 2, added as a rebuild rather than an ALTER TABLE because
// SQLite cannot add a foreign key constraint to an existing table.
const BASELINE_SCHEMA_SQL = `
-- Books are keyed by (translation, source_book_id) because OpenLP's own book ids
-- are NOT stable across translation files: KJV's 44 is Romans, NET's 44 is Acts.
-- Everything downstream references this table's surrogate id, so a verse can
-- never be captioned with another translation's book name.
CREATE TABLE IF NOT EXISTS bible_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  translation TEXT NOT NULL,
  source_book_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  testament TEXT NOT NULL CHECK (testament IN ('OT','NT','AP')),
  sort_order INTEGER NOT NULL,
  UNIQUE(translation, source_book_id)
);
CREATE INDEX IF NOT EXISTS idx_bible_books_translation ON bible_books(translation, sort_order);

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
  {
    version: 2,
    up(db) {
      // D-04: give live_state.staged_item_id a real FK now that staged_items exists.
      // ref_id on staged_items stays unconstrained — it's polymorphic across bible/song
      // ids, so a real FK there is impossible (see the comment on staged_items above).
      db.exec(`
        CREATE TABLE live_state_new (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          staged_item_id INTEGER REFERENCES staged_items(id) ON DELETE SET NULL,
          verse_or_block_id INTEGER,
          style_id INTEGER,
          hidden INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        INSERT INTO live_state_new SELECT id, staged_item_id, verse_or_block_id, style_id, hidden, updated_at FROM live_state;
        DROP TABLE live_state;
        ALTER TABLE live_state_new RENAME TO live_state;
      `);
    },
  },
  {
    version: 3,
    up(db) {
      // D-09: keep the FTS index in sync via triggers instead of relying on every
      // write path to remember to do it by hand — the importers did remember, but
      // any other delete path (e.g. a cascaded delete from songs -> song_blocks)
      // would silently orphan FTS rows. The 'delete' + insert pair on UPDATE is the
      // documented pattern for FTS5 external-content tables. Text must go through
      // normalize_for_search, the same function the importers already index with,
      // registered as a SQL function below so the trigger can call it.
      db.exec(`
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
      `);
    },
  },
];

// Keyed on PRAGMA user_version so an existing install only ever runs the steps it's
// missing; a fresh database runs every step in order. Each step commits its own
// user_version bump so a crash mid-migration resumes cleanly rather than re-running
// steps that already landed.
export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  // Backs the FTS sync triggers (migration 3). Registered on every connection since
  // custom SQL functions aren't persisted in the database file itself.
  db.function('normalize_for_search', normalizeForSearch);
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
