import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { importOpenlpBible } from '../../../src/main/import/openlpBibleImporter';
import { createFixtureBibleDb } from '../../helpers/openlpFixtures';
import { getVersesForChapter, findBooksByName, searchBibleContent } from '../../../src/main/db/bibleRepository';

let mainDb: Database.Database;

beforeEach(() => {
  mainDb = new Database(':memory:');
  applySchema(mainDb);
});

describe('importOpenlpBible', () => {
  it('imports books with the correct testament mapping and verses under the metadata translation code', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 1, name: 'Genesis', testamentReferenceId: 1 },
        { id: 43, name: 'John', testamentReferenceId: 2 },
      ],
      [
        { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth.' },
        { bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son.' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(2);
    expect(summary.kind).toBe('bible');
    expect(summary.translation).toBe('KJV');
    expect(summary.errors).toHaveLength(0);
    expect(findBooksByName(mainDb, 'John', 'KJV')[0].testament).toBe('NT');
    expect(findBooksByName(mainDb, 'Genesis', 'KJV')[0].testament).toBe('OT');
    const john = findBooksByName(mainDb, 'John', 'KJV')[0];
    expect(getVersesForChapter(mainDb, john.id, 3)[0].text).toContain('begotten Son');
  });

  // The single most important test in this plan. In the church's real files KJV's
  // source book 44 is Romans and NET's source book 44 is Acts; getting this wrong
  // captions Romans as "Acts" on the live stream.
  it('keeps two translations apart when they reuse a source book id for different books', () => {
    const kjvPath = createFixtureBibleDb(
      'KJV',
      [
        { id: 44, name: 'Romans', testamentReferenceId: 2, bookReferenceId: 45 },
        { id: 45, name: 'Acts', testamentReferenceId: 2, bookReferenceId: 44 },
      ],
      [
        { bookId: 44, chapter: 1, verse: 1, text: 'Paul, a servant of Jesus Christ.' },
        { bookId: 45, chapter: 1, verse: 1, text: 'The former treatise have I made, O Theophilus.' },
      ]
    );
    const netPath = createFixtureBibleDb(
      'NET',
      [
        { id: 44, name: 'Acts', testamentReferenceId: 2, bookReferenceId: 44 },
        { id: 45, name: 'Romans', testamentReferenceId: 2, bookReferenceId: 45 },
      ],
      [
        { bookId: 44, chapter: 1, verse: 1, text: 'I wrote the former account, Theophilus.' },
        { bookId: 45, chapter: 1, verse: 1, text: 'From Paul, a slave of Christ Jesus.' },
      ]
    );

    importOpenlpBible(mainDb, kjvPath);
    importOpenlpBible(mainDb, netPath);

    const kjvRomans = findBooksByName(mainDb, 'Romans', 'KJV')[0];
    const netActs = findBooksByName(mainDb, 'Acts', 'NET')[0];
    expect(getVersesForChapter(mainDb, kjvRomans.id, 1)[0].text).toContain('Paul, a servant');
    expect(getVersesForChapter(mainDb, netActs.id, 1)[0].text).toContain('I wrote the former account');
    // And KJV's own books are still named correctly after the second import.
    expect(findBooksByName(mainDb, 'Acts', 'KJV')[0].sourceBookId).toBe(45);
  });

  it('sorts books by book_reference_id, not by source book id', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 44, name: 'Romans', testamentReferenceId: 2, bookReferenceId: 45 },
        { id: 45, name: 'Acts', testamentReferenceId: 2, bookReferenceId: 44 },
      ],
      [{ bookId: 44, chapter: 1, verse: 1, text: 'Paul, a servant of Jesus Christ.' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    expect(findBooksByName(mainDb, '', 'KJV').map((b) => b.name)).toEqual(['Acts', 'Romans']);
  });

  it('maps an unrecognized testament_reference_id to Apocrypha', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 70, name: 'Tobit', testamentReferenceId: 3 }],
      [{ bookId: 70, chapter: 1, verse: 1, text: 'In the days of Enemessar...' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    expect(findBooksByName(mainDb, 'Tobit', 'KJV')[0].testament).toBe('AP');
  });

  it('is idempotent — re-importing upserts verse text rather than duplicating rows', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'Original text.' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    importOpenlpBible(mainDb, fixturePath);
    const genesis = findBooksByName(mainDb, 'Genesis', 'KJV')[0];
    expect(getVersesForChapter(mainDb, genesis.id, 1)).toHaveLength(1);
    expect(searchBibleContent(mainDb, 'Original', 'KJV')).toHaveLength(1);
  });

  it('makes imported verse text searchable via FTS', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 43, name: 'John', testamentReferenceId: 2 }],
      [{ bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son.' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    expect(searchBibleContent(mainDb, 'begotten', 'KJV')).toHaveLength(1);
  });

  // FTS5 external-content tables keep old terms unless they are explicitly retracted.
  it('leaves no stale search hits after a verse text changes', () => {
    const before = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'Aardvark original wording.' }]
    );
    importOpenlpBible(mainDb, before);
    const after = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'Zebra revised wording.' }]
    );
    importOpenlpBible(mainDb, after);

    expect(searchBibleContent(mainDb, 'Aardvark', 'KJV')).toHaveLength(0);
    expect(searchBibleContent(mainDb, 'Zebra', 'KJV')).toHaveLength(1);
  });
});
