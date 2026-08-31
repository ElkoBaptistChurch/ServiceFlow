import Database from 'better-sqlite3';

const SCHEMA_SQL = `
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

export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.prepare(`INSERT OR IGNORE INTO live_state (id, updated_at) VALUES (1, ?)`).run(new Date().toISOString());
}
