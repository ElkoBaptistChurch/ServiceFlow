import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  clearLiveState,
  getLiveState,
  setLiveState,
  setOutputHidden,
} from '../../../src/main/db/liveStateRepository';
import { addStagedItem } from '../../../src/main/db/stagedItemsRepository';

let db: Database.Database;
let stagedItemId: number;
let verseId: number;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare(
    `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (1, 'KJV', 43, 'John', 'NT', 43)`
  ).run();
  verseId = Number(
    db
      .prepare(`INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (1, 3, 16, 'For God so loved the world.')`)
      .run().lastInsertRowid
  );
  stagedItemId = addStagedItem(db, 'bible', 1, 3).id;
});

describe('liveStateRepository', () => {
  it('starts with an empty live state', () => {
    const state = getLiveState(db);
    expect(state.stagedItemId).toBeNull();
    expect(state.verseOrBlockId).toBeNull();
    expect(state.hidden).toBe(false);
    expect(state.reference).toBeNull();
  });

  it('sets and reads back live state', () => {
    const updated = setLiveState(db, stagedItemId, verseId, 1);
    expect(updated.stagedItemId).toBe(stagedItemId);
    expect(updated.verseOrBlockId).toBe(verseId);
    expect(updated.styleId).toBe(1);
    expect(getLiveState(db)).toEqual(updated);
  });

  // The operator banner must never show internal ids — that is the whole point of it.
  it('exposes a human-readable reference for what is live', () => {
    expect(setLiveState(db, stagedItemId, verseId, null).reference).toBe('John 3:16');
  });

  it('blanks and restores the output without losing the selection', () => {
    setLiveState(db, stagedItemId, verseId, null);
    const hidden = setOutputHidden(db, true);
    expect(hidden.hidden).toBe(true);
    expect(hidden.verseOrBlockId).toBe(verseId);
    expect(setOutputHidden(db, false).hidden).toBe(false);
  });

  it('un-blanks automatically when a new item is put live', () => {
    setOutputHidden(db, true);
    expect(setLiveState(db, stagedItemId, verseId, null).hidden).toBe(false);
  });

  it('clears live state when the live staged item goes away', () => {
    setLiveState(db, stagedItemId, verseId, null);
    const cleared = clearLiveState(db);
    expect(cleared.stagedItemId).toBeNull();
    expect(cleared.reference).toBeNull();
  });
});
