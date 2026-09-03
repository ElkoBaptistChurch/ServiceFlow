import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  findSongsByTitle,
  getBlocksForSong,
  searchSongContent,
  createSong,
  updateSong,
  deleteSong,
  addBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
} from '../../../src/main/db/songRepository';
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

  it('creates a new song', () => {
    const song = createSong(db, 'How Great Thou Art', '14181');
    expect(song.title).toBe('How Great Thou Art');
    expect(song.ccliNumber).toBe('14181');
    expect(findSongsByTitle(db, 'How Great').map((s) => s.id)).toEqual([song.id]);
  });

  it('updates a song title and CCLI number', () => {
    updateSong(db, 1, 'Amazing Grace (My Chains Are Gone)', '4768151');
    const [song] = findSongsByTitle(db, 'my chains are gone');
    expect(song.title).toBe('Amazing Grace (My Chains Are Gone)');
    expect(song.ccliNumber).toBe('4768151');
  });

  it('deletes a song and cascades to its blocks and FTS index', () => {
    deleteSong(db, 1);
    expect(findSongsByTitle(db, 'amaz')).toEqual([]);
    expect(getBlocksForSong(db, 1)).toEqual([]);
    expect(searchSongContent(db, 'chains')).toEqual([]);
  });

  it('appends a new block after the existing ones', () => {
    const block = addBlock(db, 1, 'Verse 3', 'Through many dangers, toils and snares');
    const blocks = getBlocksForSong(db, 1);
    expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus 1', 'Verse 2', 'Verse 3']);
    expect(block.displayOrder).toBe(3);
  });

  it('appends the first block to a song with none yet', () => {
    const song = createSong(db, 'Brand New Song', null);
    const block = addBlock(db, song.id, 'Verse 1', 'First line');
    expect(block.displayOrder).toBe(0);
  });

  it('updates a block label and text, keeping it searchable by its new text', () => {
    const blocks = getBlocksForSong(db, 1);
    updateBlock(db, blocks[0].id, 'Chorus 1', 'Updated chorus text');
    const updated = getBlocksForSong(db, 1)[0];
    expect(updated.label).toBe('Chorus 1');
    expect(updated.text).toBe('Updated chorus text');
    expect(searchSongContent(db, 'updated')).toHaveLength(1);
    expect(searchSongContent(db, 'sweet the sound')).toEqual([]);
  });

  it('deletes a block and removes it from the FTS index', () => {
    const blocks = getBlocksForSong(db, 1);
    deleteBlock(db, blocks[1].id);
    expect(getBlocksForSong(db, 1).map((b) => b.label)).toEqual(['Verse 1', 'Verse 2']);
    expect(searchSongContent(db, 'chains')).toEqual([]);
  });

  it('reorders a song\'s blocks', () => {
    const blocks = getBlocksForSong(db, 1);
    reorderBlocks(db, 1, [blocks[2].id, blocks[0].id, blocks[1].id]);
    const reordered = getBlocksForSong(db, 1);
    expect(reordered.map((b) => b.label)).toEqual(['Verse 2', 'Verse 1', 'Chorus 1']);
    expect(reordered.map((b) => b.displayOrder)).toEqual([0, 1, 2]);
  });
});
