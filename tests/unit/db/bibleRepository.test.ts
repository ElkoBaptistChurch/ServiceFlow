import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  findBooksByName,
  getChaptersForBook,
  getVersesForChapter,
  searchBibleContent,
  listTranslations,
} from '../../../src/main/db/bibleRepository';
import { normalizeForSearch } from '../../../src/main/db/fts';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  // Deliberately mirrors the real files: KJV's source book 44 is Romans while
  // NET's source book 44 is Acts. Any regression here mislabels scripture on air.
  const insertBook = db.prepare(
    `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertBook.run(1, 'KJV', 43, 'John', 'NT', 43);
  insertBook.run(2, 'KJV', 1, 'Genesis', 'OT', 1);
  insertBook.run(3, 'KJV', 44, 'Romans', 'NT', 45);
  insertBook.run(4, 'NET', 44, 'Acts', 'NT', 44);

  const insertVerse = db.prepare(`INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  const insertFts = db.prepare(`INSERT INTO bible_verses_fts (rowid, text) VALUES (?, ?)`);
  const rows = [
    [1, 3, 16, 'For God so loved the world, that he gave his only begotten Son.'],
    [1, 3, 17, 'For God sent not his Son into the world to condemn the world.'],
    [1, 1, 1, 'In the beginning was the Word.'],
    [3, 1, 1, 'Paul, a servant of Jesus Christ, called to be an apostle.'],
    [4, 1, 1, 'I wrote the former account, Theophilus.'],
  ] as const;
  for (const [bookId, chapter, verse, text] of rows) {
    const info = insertVerse.run(bookId, chapter, verse, text);
    insertFts.run(info.lastInsertRowid, normalizeForSearch(text));
  }
});

describe('bibleRepository', () => {
  it('finds books by partial name within the active translation', () => {
    expect(findBooksByName(db, 'joh', 'KJV').map((b) => b.name)).toEqual(['John']);
  });

  it('treats % and _ in a query as literal characters', () => {
    db.prepare(
      `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (5, 'KJV', 99, '50% Discount', 'OT', 99)`
    ).run();
    expect(findBooksByName(db, '50%', 'KJV').map((b) => b.name)).toEqual(['50% Discount']);
    expect(findBooksByName(db, 'j_hn', 'KJV')).toEqual([]);
  });

  it('finds an uppercase accented book name', () => {
    db.prepare(
      `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (5, 'RVR', 2, 'ÉXODO', 'OT', 2)`
    ).run();
    expect(findBooksByName(db, 'éxodo', 'RVR').map((b) => b.name)).toEqual(['ÉXODO']);
  });

  it('does not leak books from another translation', () => {
    expect(findBooksByName(db, 'acts', 'KJV')).toEqual([]);
    expect(findBooksByName(db, 'acts', 'NET').map((b) => b.name)).toEqual(['Acts']);
  });

  it('keeps two translations that reuse a source book id apart', () => {
    const romans = findBooksByName(db, 'romans', 'KJV')[0];
    const acts = findBooksByName(db, 'acts', 'NET')[0];
    expect(romans.sourceBookId).toBe(44);
    expect(acts.sourceBookId).toBe(44);
    expect(getVersesForChapter(db, romans.id, 1)[0].text).toContain('Paul, a servant');
    expect(getVersesForChapter(db, acts.id, 1)[0].text).toContain('Theophilus');
  });

  it('orders books by sort_order, not by source book id', () => {
    expect(findBooksByName(db, '', 'KJV').map((b) => b.name)).toEqual(['Genesis', 'John', 'Romans']);
  });

  it('lists distinct chapters for a book', () => {
    const john = findBooksByName(db, 'john', 'KJV')[0];
    expect(getChaptersForBook(db, john.id)).toEqual([1, 3]);
  });

  it('lists verses for a chapter in verse order', () => {
    const john = findBooksByName(db, 'john', 'KJV')[0];
    const verses = getVersesForChapter(db, john.id, 3);
    expect(verses.map((v) => v.verse)).toEqual([16, 17]);
    expect(verses[0].text).toContain('loved the world');
  });

  it('finds verses by content search, scoped to the translation', () => {
    const results = searchBibleContent(db, 'begotten', 'KJV');
    expect(results).toHaveLength(1);
    expect(results[0].bookName).toBe('John');
    expect(results[0].verse.verse).toBe(16);
    expect(searchBibleContent(db, 'begotten', 'NET')).toHaveLength(0);
  });

  it('does not throw on punctuation in the search query', () => {
    expect(() => searchBibleContent(db, 'God\'s "love"!', 'KJV')).not.toThrow();
  });

  it('lists the imported translations', () => {
    expect(listTranslations(db)).toEqual(['KJV', 'NET']);
  });
});
