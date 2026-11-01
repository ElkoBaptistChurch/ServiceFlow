import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../../src/main/db/schema';

function insertTranslation(db: Database.Database, id: number, code: string): void {
  db.prepare(
    `INSERT INTO bible_translations (id, code, name, source, updated_at) VALUES (?, ?, ?, 'bundled', '')`
  ).run(id, code, code);
}

function insertKjvGenesis(db: Database.Database): void {
  insertTranslation(db, 1, 'KJV');
  db.prepare(
    `INSERT INTO bible_books (id, translation_id, book_code, name, testament, sort_order) VALUES (1, 1, 'GEN', 'Genesis', 'OT', 1)`
  ).run();
}

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
      'bible_translations',
      'bible_books',
      'bible_verses',
      'song_blocks',
      'songs',
      'staged_items',
      'live_state',
      'output_styles',
      'app_settings',
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
    insertKjvGenesis(db);
    // The AFTER INSERT trigger keeps bible_verses_fts in sync — no
    // manual fts insert needed here.
    db.prepare(
      `INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (1, 1, 1, 'In the beginning God created the heaven and the earth.')`
    ).run();
    const results = db
      .prepare(
        `SELECT bv.text FROM bible_verses_fts JOIN bible_verses bv ON bv.id = bible_verses_fts.rowid WHERE bible_verses_fts MATCH 'beginning'`
      )
      .all();
    expect(results).toHaveLength(1);
  });

  it('removes FTS rows when a song is deleted', () => {
    const db = new Database(':memory:');
    applySchema(db);
    db.prepare(`INSERT INTO songs (id, title) VALUES (1, 'Amazing Grace')`).run();
    db.prepare(
      `INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (1, 'Verse 1', 'Amazing grace how sweet the sound', 0)`
    ).run();
    expect(
      db.prepare(`SELECT rowid FROM song_blocks_fts WHERE song_blocks_fts MATCH 'amazing'`).all()
    ).toHaveLength(1);

    db.prepare(`DELETE FROM songs WHERE id = 1`).run(); // cascades to song_blocks

    expect(db.prepare(`SELECT * FROM song_blocks`).all()).toHaveLength(0);
    expect(
      db.prepare(`SELECT rowid FROM song_blocks_fts WHERE song_blocks_fts MATCH 'amazing'`).all()
    ).toHaveLength(0);
  });

  it('updates bible_verses_fts when a verse is edited', () => {
    const db = new Database(':memory:');
    applySchema(db);
    insertKjvGenesis(db);
    const info = db
      .prepare(`INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (1, 1, 1, 'old wording')`)
      .run();
    db.prepare(`UPDATE bible_verses SET text = 'new wording' WHERE id = ?`).run(info.lastInsertRowid);

    expect(
      db.prepare(`SELECT rowid FROM bible_verses_fts WHERE bible_verses_fts MATCH 'old'`).all()
    ).toHaveLength(0);
    expect(
      db.prepare(`SELECT rowid FROM bible_verses_fts WHERE bible_verses_fts MATCH 'new'`).all()
    ).toHaveLength(1);
  });

  it('makes (translation, book_code) unique, but lets two translations share a book code', () => {
    const db = new Database(':memory:');
    applySchema(db);
    insertTranslation(db, 1, 'KJV');
    insertTranslation(db, 2, 'NET');
    const insert = db.prepare(
      `INSERT INTO bible_books (translation_id, book_code, name, testament, sort_order) VALUES (?, 'ROM', 'Romans', 'NT', 45)`
    );
    expect(() => {
      insert.run(1);
      insert.run(2);
    }).not.toThrow();
    expect(() => insert.run(1)).toThrow(/UNIQUE/);
  });

  it('makes the translation code unique case-insensitively', () => {
    const db = new Database(':memory:');
    applySchema(db);
    insertTranslation(db, 1, 'KJV');
    expect(() => insertTranslation(db, 2, 'kjv')).toThrow(/UNIQUE/);
    expect(db.prepare(`SELECT id FROM bible_translations WHERE code = 'Kjv'`).get()).toEqual({ id: 1 });
  });

  it('cascades a translation delete to its books, verses and search index', () => {
    const db = new Database(':memory:');
    applySchema(db);
    insertKjvGenesis(db);
    db.prepare(`INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (1, 1, 1, 'In the beginning')`).run();

    db.prepare(`DELETE FROM bible_translations WHERE id = 1`).run();

    expect(db.prepare(`SELECT COUNT(*) AS c FROM bible_books`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM bible_verses`).get()).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT rowid FROM bible_verses_fts WHERE bible_verses_fts MATCH 'beginning'`).all()
    ).toHaveLength(0);
  });

  it('rejects a book whose testament is not OT, NT or AP', () => {
    const db = new Database(':memory:');
    applySchema(db);
    insertTranslation(db, 1, 'KJV');
    expect(() =>
      db
        .prepare(
          `INSERT INTO bible_books (translation_id, book_code, name, testament, sort_order) VALUES (1, 'GEN', 'Genesis', 'XX', 1)`
        )
        .run()
    ).toThrow(/CHECK/);
  });

  it('keys song blocks by display_order so a repeated label is not lost', () => {
    const db = new Database(':memory:');
    applySchema(db);
    db.prepare(`INSERT INTO songs (id, title) VALUES (1, 'How Sweet the name of Jesus Sounds')`).run();
    const insert = db.prepare(
      `INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (1, 'Verse 1', ?, ?)`
    );
    insert.run('How sweet the name of Jesus sounds', 0);
    insert.run('It makes the wounded spirit whole', 1);
    expect(db.prepare(`SELECT COUNT(*) as c FROM song_blocks`).get()).toEqual({ c: 2 });
  });

  // D-02: a database whose tables exist but whose user_version is unset must still be
  // brought fully current instead of silently doing nothing.
  it('applies pending migrations to an existing database', () => {
    const db = new Database(':memory:');
    applySchema(db);
    db.pragma('user_version = 0');
    applySchema(db);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    const columns = (db.prepare(`PRAGMA table_info(bible_books)`).all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain('book_code');
  });

  // D12: the schema was rewritten in place, so a database from an older pre-release
  // build must fail with an instruction, not later on a missing column.
  it('refuses a database from an older pre-release build with a plain instruction', () => {
    const db = new Database(':memory:');
    db.pragma(`user_version = ${SCHEMA_VERSION + 2}`);
    expect(() => applySchema(db)).toThrow(/Delete serviceflow\.db/);
  });

  // D-04: live_state.staged_item_id has a real FK.
  it('clears live state when its staged item is deleted', () => {
    const db = new Database(':memory:');
    applySchema(db);
    const stagedItemId = db
      .prepare(`INSERT INTO staged_items (type, ref_id, chapter, position) VALUES ('song', 1, NULL, 0)`)
      .run().lastInsertRowid;
    db.prepare(`UPDATE live_state SET staged_item_id = ? WHERE id = 1`).run(stagedItemId);
    db.prepare(`DELETE FROM staged_items WHERE id = ?`).run(stagedItemId);
    const row = db.prepare(`SELECT staged_item_id FROM live_state WHERE id = 1`).get() as {
      staged_item_id: number | null;
    };
    expect(row.staged_item_id).toBeNull();
  });
});
