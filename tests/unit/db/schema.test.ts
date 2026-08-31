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
    db.prepare(
      `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (1, 'KJV', 1, 'Genesis', 'OT', 1)`
    ).run();
    const info = db
      .prepare(
        `INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (1, 1, 1, 'In the beginning God created the heaven and the earth.')`
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

  // Regression guard for the real-data fact that KJV's source book 44 is Romans
  // while NET's source book 44 is Acts. Two translations must be able to disagree.
  it('lets two translations reuse the same source_book_id for different books', () => {
    const db = new Database(':memory:');
    applySchema(db);
    const insert = db.prepare(
      `INSERT INTO bible_books (translation, source_book_id, name, testament, sort_order) VALUES (?, ?, ?, 'NT', ?)`
    );
    expect(() => {
      insert.run('KJV', 44, 'Romans', 45);
      insert.run('NET', 44, 'Acts', 44);
    }).not.toThrow();
    expect(() => insert.run('KJV', 44, 'Romans', 45)).toThrow();
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
});
