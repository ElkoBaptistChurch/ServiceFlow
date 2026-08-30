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
  db.prepare(
    `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (1, 'KJV', 43, 'John', 'NT', 43)`
  ).run();
  db.prepare(`INSERT INTO songs (id, title) VALUES (1, 'Amazing Grace')`).run();
});

describe('stagedItemsRepository', () => {
  it('stages a bible chapter with a human-readable label naming the translation', () => {
    const item = addStagedItem(db, 'bible', 1, 3);
    expect(item.label).toBe('John 3 (KJV)');
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

  it('renumbers the full set without duplicate positions when given a partial id list', () => {
    const a = addStagedItem(db, 'bible', 1, 3);
    const b = addStagedItem(db, 'song', 1, null);
    const c = addStagedItem(db, 'bible', 1, 4);
    // Caller supplies only c and a — b is omitted from the list entirely.
    reorderStagedItems(db, [c.id, a.id]);

    const items = getStagedItems(db);
    expect(items.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
    // No duplicate positions.
    expect(new Set(items.map((i) => i.position)).size).toBe(items.length);
  });

  it('ignores unknown ids in the reorder list without corrupting existing items', () => {
    const a = addStagedItem(db, 'bible', 1, 3);
    const b = addStagedItem(db, 'song', 1, null);
    const unknownId = a.id + b.id + 1000;
    reorderStagedItems(db, [b.id, unknownId, a.id]);

    const items = getStagedItems(db);
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
  });

  it('leaves existing order intact and contiguous when given an empty id list', () => {
    const a = addStagedItem(db, 'bible', 1, 3);
    const b = addStagedItem(db, 'song', 1, null);
    const c = addStagedItem(db, 'bible', 1, 4);
    reorderStagedItems(db, []);

    const items = getStagedItems(db);
    expect(items.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
  });
});
