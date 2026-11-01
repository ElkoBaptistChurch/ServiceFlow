import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  deleteTranslation,
  findBooksByName,
  getChaptersForBook,
  getVersesForChapter,
  listTranslationCodes,
  listTranslations,
  searchBibleContent,
  upsertTranslation,
} from '../../../src/main/db/bibleRepository';
import type { TranslationInput } from '../../../src/shared/types';

let db: Database.Database;

function kjv(books: TranslationInput['books'], overrides: Partial<TranslationInput> = {}): TranslationInput {
  return { code: 'KJV', name: 'King James Version', source: 'bundled', books, ...overrides };
}

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('bibleRepository reads', () => {
  beforeEach(() => {
    upsertTranslation(
      db,
      kjv([
        {
          bookCode: 'JHN',
          name: 'John',
          verses: [
            [3, 16, 'For God so loved the world, that he gave his only begotten Son.'],
            [3, 17, 'For God sent not his Son into the world to condemn the world.'],
            [1, 1, 'In the beginning was the Word.'],
          ],
        },
        { bookCode: 'GEN', name: 'Genesis', verses: [[1, 1, 'In the beginning God created.']] },
        { bookCode: 'ROM', name: 'Romans', verses: [[1, 1, 'Paul, a servant of Jesus Christ, called to be an apostle.']] },
        { bookCode: 'SNG', name: 'Song of Solomon', verses: [[1, 1, 'The song of songs, which is Solomon’s.']] },
      ])
    );
    upsertTranslation(db, {
      code: 'NET',
      name: 'New English Translation',
      source: 'openlp',
      books: [{ bookCode: 'ACT', name: 'Acts', verses: [[1, 1, 'I wrote the former account, Theophilus.']] }],
    });
  });

  it('finds books by partial name within the active translation', () => {
    expect(findBooksByName(db, 'joh', 'KJV').map((b) => b.name)).toEqual(['John']);
  });

  it('returns the book code and translation code, never a source id', () => {
    const [john] = findBooksByName(db, 'john', 'KJV');
    expect(john).toMatchObject({ bookCode: 'JHN', translationCode: 'KJV', testament: 'NT', sortOrder: 43 });
    expect(john).not.toHaveProperty('sourceBookId');
  });

  it('treats % and _ in a query as literal characters', () => {
    expect(findBooksByName(db, '50%', 'KJV')).toEqual([]);
    expect(findBooksByName(db, 'j_hn', 'KJV')).toEqual([]);
  });

  it('finds an uppercase accented book name', () => {
    upsertTranslation(db, { code: 'RVR', name: 'Reina-Valera', source: 'file', books: [{ bookCode: 'EXO', name: 'ÉXODO', verses: [[1, 1, 'Estos son los nombres']] }] });
    expect(findBooksByName(db, 'éxodo', 'RVR').map((b) => b.name)).toEqual(['ÉXODO']);
  });

  it('finds a book by a canonical alias the translation does not use', () => {
    expect(findBooksByName(db, 'Song of Songs', 'KJV').map((b) => b.bookCode)).toEqual(['SNG']);
    expect(findBooksByName(db, 'canticles', 'KJV').map((b) => b.name)).toEqual(['Song of Solomon']);
  });

  it('does not leak books from another translation', () => {
    expect(findBooksByName(db, 'acts', 'KJV')).toEqual([]);
    expect(findBooksByName(db, 'acts', 'NET').map((b) => b.name)).toEqual(['Acts']);
  });

  it('orders books canonically, not in input order', () => {
    expect(findBooksByName(db, '', 'KJV').map((b) => b.bookCode)).toEqual(['GEN', 'SNG', 'JHN', 'ROM']);
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

  it('finds verses by content search, scoped to the translation code', () => {
    const results = searchBibleContent(db, 'begotten', 'KJV');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ bookName: 'John', translation: 'KJV' });
    expect(results[0].verse.verse).toBe(16);
    expect(searchBibleContent(db, 'begotten', 'NET')).toHaveLength(0);
  });

  it('does not throw on punctuation in the search query', () => {
    expect(() => searchBibleContent(db, 'God\'s "love"!', 'KJV')).not.toThrow();
  });

  it('lists translations with their counts, sorted by code', () => {
    expect(listTranslations(db)).toEqual([
      { code: 'KJV', name: 'King James Version', source: 'bundled', licenseNote: null, bookCount: 4, verseCount: 6 },
      { code: 'NET', name: 'New English Translation', source: 'openlp', licenseNote: null, bookCount: 1, verseCount: 1 },
    ]);
    expect(listTranslationCodes(db)).toEqual(['KJV', 'NET']);
  });
});

describe('upsertTranslation', () => {
  it('reports imported counts and writes testament and order from the canonical list', () => {
    const result = upsertTranslation(
      db,
      kjv([{ bookCode: 'TOB', name: 'Tobit', verses: [[1, 1, 'The book of the words of Tobit']] }])
    );
    expect(result).toMatchObject({ kind: 'bible', translation: 'KJV', imported: 1, skipped: 0, errors: [] });
    const [tobit] = findBooksByName(db, 'tobit', 'KJV');
    expect(tobit.testament).toBe('AP');
    expect(tobit.sortOrder).toBeGreaterThan(66);
  });

  it('defaults a missing book name to the canonical name', () => {
    upsertTranslation(db, kjv([{ bookCode: '1JN', verses: [[1, 1, 'That which was from the beginning']] }]));
    expect(findBooksByName(db, '1 john', 'KJV')[0].name).toBe('1 John');
  });

  // D5: a partial source (the church's NET has 106 verses) must never erase a fuller one.
  it('upserts without deleting verses the new input lacks', () => {
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'One.'], [1, 2, 'Two.']] }]));
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'One.']] }]));
    const genesis = findBooksByName(db, 'genesis', 'KJV')[0];
    expect(getVersesForChapter(db, genesis.id, 1).map((v) => v.text)).toEqual(['One.', 'Two.']);
  });

  it('updates changed text in place, keeping the verse id', () => {
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'Original text.']] }]));
    const genesis = findBooksByName(db, 'genesis', 'KJV')[0];
    const before = getVersesForChapter(db, genesis.id, 1)[0];
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'Revised text.']] }]));
    const after = getVersesForChapter(db, genesis.id, 1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before.id, text: 'Revised text.' });
  });

  // FTS5 external-content tables keep old terms unless they are explicitly retracted.
  it('keeps the search index in sync on insert and update', () => {
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'Aardvark original wording.']] }]));
    expect(searchBibleContent(db, 'Aardvark', 'KJV')).toHaveLength(1);
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'Zebra revised wording.']] }]));
    expect(searchBibleContent(db, 'Aardvark', 'KJV')).toHaveLength(0);
    expect(searchBibleContent(db, 'Zebra', 'KJV')).toHaveLength(1);
  });

  it('skips and reports a verse with a non-numeric chapter or verse, importing the rest', () => {
    const result = upsertTranslation(
      db,
      kjv([
        {
          bookCode: 'GEN',
          verses: [
            ['abc' as unknown as number, 2, 'Malformed chapter row.'],
            [1, 'xyz' as unknown as number, 'Malformed verse row.'],
            [1, 1, 'Valid verse.'],
          ],
        },
      ])
    );
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors.every((e) => /chapter or verse/i.test(e.reason))).toBe(true);
    const genesis = findBooksByName(db, 'genesis', 'KJV')[0];
    expect(getVersesForChapter(db, genesis.id, 1).map((v) => v.text)).toEqual(['Valid verse.']);
  });

  it('skips and reports a verse with empty text', () => {
    const result = upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, '   '], [1, 2, 'Real.']] }]));
    expect(result.imported).toBe(1);
    expect(result.errors[0]).toEqual({ identifier: 'KJV GEN 1:1', reason: 'verse has no text' });
  });

  // KJV's apocryphal Sirach has a real 1:0 prologue (D10) — verse 0 is not malformed.
  it('keeps verse 0', () => {
    upsertTranslation(db, kjv([{ bookCode: 'SIR', verses: [[1, 0, 'Whereas many and great things…']] }]));
    const sirach = findBooksByName(db, 'sirach', 'KJV')[0];
    expect(getVersesForChapter(db, sirach.id, 1)[0].verse).toBe(0);
  });

  it('skips an unknown book code with one error, and its verses with it, without rolling back the rest', () => {
    const result = upsertTranslation(
      db,
      kjv([
        { bookCode: 'GEN', verses: [[1, 1, 'In the beginning.']] },
        { bookCode: 'XYZ', name: 'Hezekiah', verses: [[1, 1, 'a'], [1, 2, 'b']] },
        { bookCode: 'JHN', verses: [[3, 16, 'For God so loved the world.']] },
      ])
    );
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].identifier).toBe('book XYZ');
    expect(result.errors[0].reason).toMatch(/unknown book code "XYZ" \(2 verses skipped\)/);
    expect(findBooksByName(db, '', 'KJV').map((b) => b.bookCode)).toEqual(['GEN', 'JHN']);
  });

  // D-06: a structural failure partway through must leave the database untouched.
  it('is atomic when the input is structurally broken', () => {
    const broken = kjv([
      { bookCode: 'GEN', verses: [[1, 1, 'In the beginning.']] },
      null as unknown as TranslationInput['books'][number],
    ]);
    expect(() => upsertTranslation(db, broken)).toThrow();
    expect(listTranslations(db)).toEqual([]);
  });

  it('updates name, source and licence when the same code is re-upserted', () => {
    upsertTranslation(db, kjv([{ bookCode: 'GEN', verses: [[1, 1, 'In the beginning.']] }]));
    const result = upsertTranslation(
      db,
      kjv([{ bookCode: 'GEN', verses: [[1, 1, 'In the beginning.']] }], {
        code: 'kjv',
        name: 'KJV (OpenLP)',
        source: 'openlp',
        licenseNote: 'Crown copyright in the UK',
      })
    );
    // Same translation, matched case-insensitively; its stored code spelling is kept.
    expect(result.translation).toBe('KJV');
    expect(listTranslations(db)).toEqual([
      { code: 'KJV', name: 'KJV (OpenLP)', source: 'openlp', licenseNote: 'Crown copyright in the UK', bookCount: 1, verseCount: 1 },
    ]);
  });

  it('refuses an input with no code', () => {
    expect(() => upsertTranslation(db, kjv([], { code: '  ' }))).toThrow(/no code/);
  });
});

describe('deleteTranslation', () => {
  it('removes the translation, its books, verses and search hits, and returns the removed book ids', () => {
    upsertTranslation(db, kjv([{ bookCode: 'JHN', verses: [[3, 16, 'begotten']] }, { bookCode: 'GEN', verses: [[1, 1, 'beginning']] }]));
    upsertTranslation(db, { code: 'NET', name: 'NET', source: 'openlp', books: [{ bookCode: 'JHN', verses: [[3, 16, 'begotten']] }] });
    const kjvIds = findBooksByName(db, '', 'KJV').map((b) => b.id);

    const { removedBookIds } = deleteTranslation(db, 'kjv');

    expect(removedBookIds.sort()).toEqual(kjvIds.sort());
    expect(listTranslationCodes(db)).toEqual(['NET']);
    expect(searchBibleContent(db, 'begotten', 'KJV')).toHaveLength(0);
    expect(searchBibleContent(db, 'begotten', 'NET')).toHaveLength(1);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM bible_verses`).get()).toEqual({ c: 1 });
  });

  it('is a no-op for an unknown code', () => {
    expect(deleteTranslation(db, 'NOPE')).toEqual({ removedBookIds: [] });
  });
});
