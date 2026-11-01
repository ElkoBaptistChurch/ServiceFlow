import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applySchema } from '../../../src/main/db/schema';
import { importOpenlpBible } from '../../../src/main/import/openlpBibleImporter';
import { createFixtureBibleDb } from '../../helpers/openlpFixtures';
import {
  getVersesForChapter,
  findBooksByName,
  searchBibleContent,
  listTranslations,
} from '../../../src/main/db/bibleRepository';

// The shared createFixtureBibleDb mirrors the real file's schema exactly, where
// `book.id INTEGER PRIMARY KEY` is a rowid alias: binding NULL there makes SQLite
// autoassign a real id rather than storing NULL. To exercise the defensive "book
// row has a NULL id" branch we need a source table where `id` is an ordinary
// column, so this local builder skips the PRIMARY KEY constraint on purpose.
// D-06: a fixture whose verse table is missing the text column, so reading verses
// throws structurally (not a per-row error) after books have already been read.
function createFixtureBibleDbMissingVerseTextColumn(
  translationName: string,
  books: { id: number; name: string | null; testamentReferenceId: number; bookReferenceId?: number }[]
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-brokenverse-')), 'bible.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER NOT NULL PRIMARY KEY, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER);
  `);
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('name', ?)`).run(translationName);
  const insertBook = db.prepare(
    `INSERT INTO book (id, book_reference_id, testament_reference_id, name) VALUES (?, ?, ?, ?)`
  );
  books.forEach((b) => insertBook.run(b.id, b.bookReferenceId ?? b.id, b.testamentReferenceId, b.name));
  db.close();
  return dbPath;
}

// I-09b/D-01: a fixture with no metadata name row at all, forcing the path.basename
// fallback.
function createFixtureBibleDbNoMetadataName(
  books: { id: number; name: string | null; testamentReferenceId: number; bookReferenceId?: number }[],
  verses: { bookId: number; chapter: number | string; verse: number | string; text: string }[],
  fileName = 'bible.sqlite'
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-nometa-')), fileName);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER NOT NULL PRIMARY KEY, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
  `);
  const insertBook = db.prepare(
    `INSERT INTO book (id, book_reference_id, testament_reference_id, name) VALUES (?, ?, ?, ?)`
  );
  books.forEach((b) => insertBook.run(b.id, b.bookReferenceId ?? b.id, b.testamentReferenceId, b.name));
  const insertVerse = db.prepare(`INSERT INTO verse (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  verses.forEach((v) => insertVerse.run(v.bookId, v.chapter, v.verse, v.text));
  db.close();
  return dbPath;
}

function createFixtureBibleDbWithRawBookRows(
  translationName: string,
  bookRows: { id: number | null; name: string | null; bookReferenceId: number | null; testamentReferenceId: number | null }[],
  verseRows: { bookId: number; chapter: number | string; verse: number | string; text: string }[]
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-raw-')), 'bible.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
  `);
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('name', ?)`).run(translationName);
  const insertBook = db.prepare(
    `INSERT INTO book (id, book_reference_id, testament_reference_id, name) VALUES (?, ?, ?, ?)`
  );
  bookRows.forEach((b) => insertBook.run(b.id, b.bookReferenceId, b.testamentReferenceId, b.name));
  const insertVerse = db.prepare(`INSERT INTO verse (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  verseRows.forEach((v) => insertVerse.run(v.bookId, v.chapter, v.verse, v.text));
  db.close();
  return dbPath;
}

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

// Fix round 1: a single malformed book or verse row must never abort the whole
// file's import. bookTx previously had no per-row try/catch, so any bad book row
// rolled back the entire transaction -- 0 books and 0 verses imported, including
// every valid one.
describe('importOpenlpBible — malformed row resilience', () => {
  it('skips a book row with a NULL name and still imports the valid books and verses around it', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 1, name: 'Genesis', testamentReferenceId: 1 },
        { id: 2, name: null, testamentReferenceId: 1 },
        { id: 3, name: 'John', testamentReferenceId: 2 },
      ],
      [
        { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning...' },
        { bookId: 2, chapter: 1, verse: 1, text: 'Verse under the nameless book.' },
        { bookId: 3, chapter: 3, verse: 16, text: 'For God so loved the world...' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    // 2 valid books' verses import; the nameless book's own row is skipped, and its
    // verse is skipped too because it can never be linked to a real book.
    expect(summary.imported).toBe(2);
    expect(summary.skipped).toBeGreaterThanOrEqual(2); // the book row + its orphaned verse
    expect(findBooksByName(mainDb, 'Genesis', 'KJV')).toHaveLength(1);
    expect(findBooksByName(mainDb, 'John', 'KJV')).toHaveLength(1);
    const badBookError = summary.errors.find((e) => e.identifier === 'book 2');
    expect(badBookError).toBeDefined();
    expect(badBookError!.reason).toMatch(/name/i);
    const orphanedVerseError = summary.errors.find((e) => e.identifier === 'KJV 2:1:1');
    expect(orphanedVerseError).toBeDefined();
    expect(orphanedVerseError!.reason).toMatch(/unknown source book id 2/);
  });

  // D-06: a structural failure partway through a file (verses could not even be read)
  // must not leave books committed on their own — the file must be all-or-nothing.
  it('leaves no books behind when verse import fails', () => {
    const fixturePath = createFixtureBibleDbMissingVerseTextColumn('KJV', [
      { id: 1, name: 'Genesis', testamentReferenceId: 1 },
    ]);

    expect(() => importOpenlpBible(mainDb, fixturePath)).toThrow();
    expect(findBooksByName(mainDb, 'Genesis', 'KJV')).toHaveLength(0);
  });

  it('skips a book row with a NULL id and still imports the valid books and verses around it', () => {
    const fixturePath = createFixtureBibleDbWithRawBookRows(
      'KJV',
      [
        { id: 1, name: 'Genesis', bookReferenceId: 1, testamentReferenceId: 1 },
        { id: null, name: 'Ghost Book', bookReferenceId: 2, testamentReferenceId: 1 },
        { id: 3, name: 'John', bookReferenceId: 3, testamentReferenceId: 2 },
      ],
      [
        { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning...' },
        { bookId: 3, chapter: 3, verse: 16, text: 'For God so loved the world...' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(2);
    expect(findBooksByName(mainDb, 'Genesis', 'KJV')).toHaveLength(1);
    expect(findBooksByName(mainDb, 'John', 'KJV')).toHaveLength(1);
    expect(findBooksByName(mainDb, 'Ghost Book', 'KJV')).toHaveLength(0);
    const badBookError = summary.errors.find((e) => e.identifier === 'book row 1');
    expect(badBookError).toBeDefined();
    expect(badBookError!.reason).toMatch(/id/i);
  });

  it('skips a verse with a non-numeric chapter and reports it, importing the rest', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [
        { bookId: 1, chapter: 'abc', verse: 2, text: 'Malformed chapter row.' },
        { bookId: 1, chapter: 1, verse: 1, text: 'Valid verse.' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors[0].reason).toMatch(/chapter or verse/i);
    const genesis = findBooksByName(mainDb, 'Genesis', 'KJV')[0];
    expect(getVersesForChapter(mainDb, genesis.id, 1)).toHaveLength(1);
    // The malformed row must never be reachable via the numeric chapter lookup.
    expect(getVersesForChapter(mainDb, genesis.id, 1)[0].text).toBe('Valid verse.');
  });

  it('skips a verse with a non-numeric verse number and reports it, importing the rest', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [
        { bookId: 1, chapter: 1, verse: 'xyz', text: 'Malformed verse row.' },
        { bookId: 1, chapter: 1, verse: 1, text: 'Valid verse.' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors[0].reason).toMatch(/chapter or verse/i);
    const genesis = findBooksByName(mainDb, 'Genesis', 'KJV')[0];
    expect(getVersesForChapter(mainDb, genesis.id, 1)).toHaveLength(1);
  });
});

// D-01: ON CONFLICT(translation, source_book_id) DO UPDATE SET name=... used to rename
// a book row in place while leaving its old verses attached — mixing one edition's
// scripture under another edition's book name.
describe('importOpenlpBible — re-importing a different edition under the same translation', () => {
  it('does not merge two different editions that share a translation name', () => {
    const editionA = createFixtureBibleDb(
      'KJV',
      [{ id: 44, name: 'Romans', testamentReferenceId: 2 }],
      [
        { bookId: 44, chapter: 1, verse: 2, text: 'Which he had promised afore.' },
        { bookId: 44, chapter: 16, verse: 25, text: 'Now to him that is of power.' },
      ]
    );
    importOpenlpBible(mainDb, editionA);

    // A with-Apocrypha (or otherwise re-numbered) build where source book 44 is now
    // Acts, and this edition never supplies chapter 16 at all.
    const editionB = createFixtureBibleDb(
      'KJV',
      [{ id: 44, name: 'Acts', testamentReferenceId: 2 }],
      [{ bookId: 44, chapter: 1, verse: 1, text: 'The former treatise have I made, O Theophilus.' }]
    );
    importOpenlpBible(mainDb, editionB);

    const acts = findBooksByName(mainDb, 'Acts', 'KJV')[0];
    expect(acts.sourceBookId).toBe(44);
    expect(getVersesForChapter(mainDb, acts.id, 1).map((v) => v.text)).toEqual([
      'The former treatise have I made, O Theophilus.',
    ]);
    // Romans 16:25 must not survive relabeled as "Acts 16:25".
    expect(getVersesForChapter(mainDb, acts.id, 16)).toHaveLength(0);
  });

  // I-09b: two unrelated files with no declared name both fall back to the same
  // path.basename ("bible.sqlite") and must not collapse into one translation bucket.
  it('keeps two same-basename files as separate translations', () => {
    const kjvPath = createFixtureBibleDbNoMetadataName(
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'In the beginning...' }]
    );
    const netPath = createFixtureBibleDbNoMetadataName(
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'In the beginning, God created...' }]
    );

    const summaryA = importOpenlpBible(mainDb, kjvPath);
    const summaryB = importOpenlpBible(mainDb, netPath);

    expect(summaryA.translation).toBe('bible');
    expect(summaryB.translation).not.toBe('bible');
    expect(listTranslations(mainDb)).toHaveLength(2);
    const genesisA = findBooksByName(mainDb, 'Genesis', summaryA.translation!)[0];
    const genesisB = findBooksByName(mainDb, 'Genesis', summaryB.translation!)[0];
    expect(getVersesForChapter(mainDb, genesisA.id, 1)[0].text).toBe('In the beginning...');
    expect(getVersesForChapter(mainDb, genesisB.id, 1)[0].text).toBe('In the beginning, God created...');
  });
});
