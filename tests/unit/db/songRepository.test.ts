import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { findSongsByTitle, getBlocksForSong, searchSongContent } from '../../../src/main/db/songRepository';
import { normalizeForSearch } from '../../../src/main/db/fts';

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
    ["Chorus 1", "My chains are gone, I've been set free", 1],
    // 109 of the church's songs use a typographic apostrophe like this one.
    ["Verse 2", "In a believer\u2019s ear!", 2],
  ] as const;
  for (const [label, text, order] of blocks) {
    const info = insertBlock.run(1, label, text, order);
    insertFts.run(info.lastInsertRowid, normalizeForSearch(text));
  }
});

describe('songRepository', () => {
  it('finds songs by partial title', () => {
    expect(findSongsByTitle(db, 'amaz').map((s) => s.title)).toEqual(['Amazing Grace']);
  });

  it('treats % and _ in a query as literal characters', () => {
    db.prepare(`INSERT INTO songs (id, title) VALUES (2, '50% Off Your Sins')`).run();
    expect(findSongsByTitle(db, '50%').map((s) => s.title)).toEqual(['50% Off Your Sins']);
    expect(findSongsByTitle(db, 'z_ng')).toEqual([]);
  });

  it('lists blocks for a song in display order', () => {
    const blocks = getBlocksForSong(db, 1);
    expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus 1', 'Verse 2']);
  });

  it('finds blocks by content search', () => {
    const results = searchSongContent(db, 'chains');
    expect(results).toHaveLength(1);
    expect(results[0].songTitle).toBe('Amazing Grace');
    expect(results[0].block.label).toBe('Chorus 1');
  });

  it('matches lyrics written with a typographic apostrophe from an ASCII query', () => {
    const results = searchSongContent(db, "believer's");
    expect(results).toHaveLength(1);
    expect(results[0].block.label).toBe('Verse 2');
  });
});
