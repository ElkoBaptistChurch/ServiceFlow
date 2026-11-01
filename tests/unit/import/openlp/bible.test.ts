import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applySchema } from '../../../../src/main/db/schema';
import { importOpenlpBible, readOpenlpBible } from '../../../../src/main/import/openlp/bible';
import { createFixtureBibleDb } from '../../../helpers/openlpFixtures';
import {
  findBooksByName,
  getVersesForChapter,
  listTranslations,
  upsertTranslation,
} from '../../../../src/main/db/bibleRepository';

type BookRow = { id: number | null; name: string | null; bookReferenceId: number | null; testamentReferenceId: number | null };
type VerseRow = { bookId: number; chapter: number | string; verse: number | string; text: string };

// A source whose `book.id` is an ordinary column (not a rowid alias), so a NULL id can
// actually be stored — the real schema's INTEGER PRIMARY KEY would autoassign one.
function createRawBibleDb(
  meta: Record<string, string>,
  books: BookRow[],
  verses: VerseRow[],
  opts: { fileName?: string; dir?: string; omitVerseText?: boolean } = {}
): string {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-raw-'));
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, opts.fileName ?? 'bible.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER${opts.omitVerseText ? '' : ', text TEXT'});
  `);
  for (const [k, v] of Object.entries(meta)) db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?)`).run(k, v);
  const insertBook = db.prepare(`INSERT INTO book (id, book_reference_id, testament_reference_id, name) VALUES (?, ?, ?, ?)`);
  books.forEach((b) => insertBook.run(b.id, b.bookReferenceId, b.testamentReferenceId, b.name));
  if (!opts.omitVerseText) {
    const insertVerse = db.prepare(`INSERT INTO verse (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
    verses.forEach((v) => insertVerse.run(v.bookId, v.chapter, v.verse, v.text));
  }
  db.close();
  return dbPath;
}

// The 12 apocryphal books of OpenLP's KJV (ids 67-78). D7: id 69 "Esdras" carries
// testament 1 and shares book_reference_id 15 with Ezra; the other 11 carry testament 3.
// Names to be re-confirmed against the church's real KJV.sqlite (plan Task 11).
const KJV_APOCRYPHA: [id: number, name: string, ref: number, testament: number, code: string][] = [
  [67, 'Tobit', 67, 3, 'TOB'],
  [68, 'Judith', 68, 3, 'JDT'],
  [69, 'Esdras', 15, 1, '1ES'],
  [70, '2 Esdras', 70, 3, '2ES'],
  [71, 'Wisdom', 71, 3, 'WIS'],
  [72, 'Sirach', 72, 3, 'SIR'],
  [73, 'Baruch', 73, 3, 'BAR'],
  [74, '1 Maccabees', 74, 3, '1MA'],
  [75, '2 Maccabees', 75, 3, '2MA'],
  [76, 'Prayer of Manasses', 76, 3, 'MAN'],
  [77, 'Susanna', 77, 3, 'SUS'],
  [78, 'Bel and the Dragon', 78, 3, 'BEL'],
];

let mainDb: Database.Database;

beforeEach(() => {
  mainDb = new Database(':memory:');
  applySchema(mainDb);
});

describe('importOpenlpBible', () => {
  it('imports books under canonical codes and the translation under its code', () => {
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

    expect(summary).toMatchObject({ file: 'bible.sqlite', kind: 'bible', translation: 'KJV', imported: 2, errors: [] });
    const john = findBooksByName(mainDb, 'John', 'KJV')[0];
    expect(john).toMatchObject({ bookCode: 'JHN', testament: 'NT' });
    expect(getVersesForChapter(mainDb, john.id, 3)[0].text).toContain('begotten Son');
    expect(listTranslations(mainDb)[0].source).toBe('openlp');
  });

  // The single most important regression in this importer: in the church's real files
  // KJV's source book 44 is Romans and NET's source book 44 is Acts. Getting this wrong
  // captions Romans as "Acts" on the live stream.
  it('maps the KJV/NET Romans↔Acts source-id swap to ROM and ACT in both', () => {
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
      'New English Translation (NET)',
      [
        { id: 44, name: 'Acts', testamentReferenceId: 2, bookReferenceId: 44 },
        { id: 45, name: 'Romans', testamentReferenceId: 2, bookReferenceId: 45 },
      ],
      [
        { bookId: 44, chapter: 2, verse: 1, text: 'Now when the day of Pentecost had come.' },
        { bookId: 45, chapter: 7, verse: 1, text: 'Or do you not know, brothers and sisters.' },
      ]
    );

    importOpenlpBible(mainDb, kjvPath);
    importOpenlpBible(mainDb, netPath);

    for (const code of ['KJV', 'NET']) {
      const books = findBooksByName(mainDb, '', code);
      expect(books.map((b) => [b.bookCode, b.name])).toEqual([
        ['ACT', 'Acts'],
        ['ROM', 'Romans'],
      ]);
    }
    const kjvRomans = findBooksByName(mainDb, 'Romans', 'KJV')[0];
    expect(getVersesForChapter(mainDb, kjvRomans.id, 1)[0].text).toContain('Paul, a servant');
    const netActs = findBooksByName(mainDb, 'Acts', 'NET')[0];
    expect(getVersesForChapter(mainDb, netActs.id, 2)[0].text).toContain('Pentecost');
  });

  it('maps KJV Ezra and Esdras — both book_reference_id 15 — to EZR and 1ES', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 15, name: 'Ezra', testamentReferenceId: 1, bookReferenceId: 15 },
        { id: 69, name: 'Esdras', testamentReferenceId: 1, bookReferenceId: 15 },
      ],
      [
        { bookId: 15, chapter: 1, verse: 1, text: 'Now in the first year of Cyrus king of Persia.' },
        { bookId: 69, chapter: 1, verse: 1, text: 'And Josias held the feast of the passover in Jerusalem.' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(2);
    expect(summary.skipped).toBe(0);
    const ezra = findBooksByName(mainDb, 'Ezra', 'KJV')[0];
    const esdras = findBooksByName(mainDb, 'Esdras', 'KJV')[0];
    expect(ezra).toMatchObject({ bookCode: 'EZR', testament: 'OT' });
    expect(esdras).toMatchObject({ bookCode: '1ES', testament: 'AP' });
    expect(getVersesForChapter(mainDb, esdras.id, 1)[0].text).toContain('Josias');
    // The reference-id/name disagreement is reported as a note, not silently resolved.
    expect(summary.errors).toEqual([
      expect.objectContaining({ identifier: 'book 69 (Esdras)', reason: expect.stringMatching(/^note: .*Ezra.*1 Esdras/) }),
    ]);
  });

  it('maps all 12 KJV apocryphal books', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      KJV_APOCRYPHA.map(([id, name, ref, testament]) => ({ id, name, bookReferenceId: ref, testamentReferenceId: testament })),
      KJV_APOCRYPHA.map(([id]) => ({ bookId: id, chapter: 1, verse: 1, text: `Text of book ${id}.` }))
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(12);
    expect(summary.skipped).toBe(0);
    const books = findBooksByName(mainDb, '', 'KJV');
    expect(books.map((b) => b.bookCode).sort()).toEqual(KJV_APOCRYPHA.map((b) => b[4]).sort());
    expect(books.every((b) => b.testament === 'AP')).toBe(true);
  });

  // D10: Sirach 1:0 is the 3,133-character prologue, a real verse numbered 0.
  it('preserves Sirach 1:0', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 72, name: 'Sirach', testamentReferenceId: 3, bookReferenceId: 72 }],
      [
        { bookId: 72, chapter: 1, verse: 0, text: 'Whereas many and great things have been delivered unto us.' },
        { bookId: 72, chapter: 1, verse: 1, text: 'All wisdom cometh from the Lord.' },
      ]
    );
    importOpenlpBible(mainDb, fixturePath);
    const sirach = findBooksByName(mainDb, 'Sirach', 'KJV')[0];
    expect(getVersesForChapter(mainDb, sirach.id, 1).map((v) => v.verse)).toEqual([0, 1]);
  });

  // Plan open question 3: OpenLP's KJV lands on the bundled KJV's code and updates it in
  // place — no second "KJV" — and the source becomes openlp.
  it('updates the bundled KJV in place rather than adding a second KJV', () => {
    upsertTranslation(mainDb, {
      code: 'KJV',
      name: 'King James Version',
      source: 'bundled',
      books: [{ bookCode: 'GEN', verses: [[1, 1, 'In the beginning God created the heaven and the earth.'], [1, 2, 'And the earth was without form.']] }],
    });
    const genesisBefore = findBooksByName(mainDb, 'Genesis', 'KJV')[0];
    const fixturePath = createFixtureBibleDb(
      'King James Version',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth.' }],
      { metadata: { copyright: 'Public Domain' } }
    );

    importOpenlpBible(mainDb, fixturePath);

    expect(listTranslations(mainDb)).toEqual([
      { code: 'KJV', name: 'King James Version', source: 'openlp', licenseNote: 'Public Domain', bookCount: 1, verseCount: 2 },
    ]);
    expect(findBooksByName(mainDb, 'Genesis', 'KJV')[0].id).toBe(genesisBefore.id);
  });

  it('skips a book it cannot identify, and reports its verses once — never guessing', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 1, name: 'Genesis', testamentReferenceId: 1 },
        { id: 90, name: 'Book of Jasher', testamentReferenceId: 3, bookReferenceId: 90 },
      ],
      [
        { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning...' },
        { bookId: 90, chapter: 1, verse: 1, text: 'a' },
        { bookId: 90, chapter: 1, verse: 2, text: 'b' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(3); // the book row + its two verses
    expect(summary.errors.map((e) => e.identifier)).toEqual(['book 90 (Book of Jasher)', 'KJV source book 90']);
    expect(summary.errors[0].reason).toMatch(/unrecognised book name "Book of Jasher"/);
    expect(summary.errors[1].reason).toMatch(/^2 verses skipped/);
    expect(findBooksByName(mainDb, '', 'KJV').map((b) => b.bookCode)).toEqual(['GEN']);
  });

  it('maps a canonical book with no name by its reference id, using the canonical name', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [{ id: 2, name: null, testamentReferenceId: 1, bookReferenceId: 2 }],
      [{ bookId: 2, chapter: 1, verse: 1, text: 'Now these are the names.' }]
    );
    const summary = importOpenlpBible(mainDb, fixturePath);
    expect(summary.imported).toBe(1);
    expect(findBooksByName(mainDb, '', 'KJV')[0]).toMatchObject({ bookCode: 'EXO', name: 'Exodus' });
  });

  it('accepts a non-English book name by its reference id', () => {
    const fixturePath = createFixtureBibleDb(
      'RVR1960',
      [{ id: 40, name: 'Mateo', testamentReferenceId: 2, bookReferenceId: 40 }],
      [{ bookId: 40, chapter: 1, verse: 1, text: 'Libro de la genealogía de Jesucristo.' }]
    );
    importOpenlpBible(mainDb, fixturePath);
    expect(findBooksByName(mainDb, '', 'RVR1960')[0]).toMatchObject({ bookCode: 'MAT', name: 'Mateo' });
  });

  it('skips a book row with a NULL id and still imports the books around it', () => {
    const fixturePath = createRawBibleDb(
      { name: 'KJV' },
      [
        { id: 1, name: 'Genesis', bookReferenceId: 1, testamentReferenceId: 1 },
        { id: null, name: 'Ghost Book', bookReferenceId: 2, testamentReferenceId: 1 },
        { id: 43, name: 'John', bookReferenceId: 43, testamentReferenceId: 2 },
      ],
      [
        { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning...' },
        { bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world...' },
      ]
    );

    const summary = importOpenlpBible(mainDb, fixturePath);

    expect(summary.imported).toBe(2);
    expect(summary.errors).toEqual([{ identifier: 'book row 1', reason: expect.stringMatching(/NULL id/) }]);
    expect(findBooksByName(mainDb, '', 'KJV').map((b) => b.bookCode)).toEqual(['GEN', 'JHN']);
  });

  it('never merges two rows that name the same book', () => {
    const fixturePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 43, name: 'John', testamentReferenceId: 2 },
        { id: 99, name: 'John', testamentReferenceId: 2, bookReferenceId: 43 },
      ],
      [
        { bookId: 43, chapter: 1, verse: 1, text: 'In the beginning was the Word.' },
        { bookId: 99, chapter: 1, verse: 1, text: 'Something else entirely.' },
      ]
    );
    const summary = importOpenlpBible(mainDb, fixturePath);
    const john = findBooksByName(mainDb, 'John', 'KJV')[0];
    expect(getVersesForChapter(mainDb, john.id, 1).map((v) => v.text)).toEqual(['In the beginning was the Word.']);
    expect(summary.errors[0].reason).toMatch(/both this and book 43/);
  });

  it('passes malformed verse rows to the repository, which skips and reports them', () => {
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
  });

  // D-06: a structural failure (verses can't even be read) must leave nothing behind.
  it('writes nothing when the verse table is structurally broken', () => {
    const fixturePath = createRawBibleDb(
      { name: 'KJV' },
      [{ id: 1, name: 'Genesis', bookReferenceId: 1, testamentReferenceId: 1 }],
      [],
      { omitVerseText: true }
    );
    expect(() => importOpenlpBible(mainDb, fixturePath)).toThrow();
    expect(listTranslations(mainDb)).toEqual([]);
  });
});

describe('readOpenlpBible — translation code and name', () => {
  const genesis = [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }];
  const verse = [{ bookId: 1, chapter: 1, verse: 1, text: 'In the beginning.' }];

  it.each([
    ['KJV', 'KJV', 'KJV'],
    ['King James Version', 'KJV', 'King James Version'],
    ['New King James Version (NKJV)', 'NKJV', 'New King James Version'],
    ['New English Translation (NET)', 'NET', 'New English Translation'],
    ['English Standard Version (ESV)', 'ESV', 'English Standard Version'],
    ['ESV', 'ESV', 'ESV'],
  ])('derives the code from metadata name %j', (metaName, code, name) => {
    const { input } = readOpenlpBible(createFixtureBibleDb(metaName, genesis, verse));
    expect(input).toMatchObject({ code, name, source: 'openlp' });
  });

  it('falls back to the file name when the metadata name is not a recognisable code', () => {
    const p = createFixtureBibleDb('Reina-Valera de 1960 con referencias cruzadas', genesis, verse, { fileName: 'rvr1960.sqlite' });
    expect(readOpenlpBible(p).input).toMatchObject({ code: 'RVR1960', name: 'Reina-Valera de 1960 con referencias cruzadas' });
  });

  it('carries the metadata copyright as the licence note', () => {
    const p = createFixtureBibleDb('KJV', genesis, verse, { metadata: { copyright: 'Public Domain' } });
    expect(readOpenlpBible(p).input.licenseNote).toBe('Public Domain');
  });

  // I-09b: two unrelated files with no usable name, both called "bible.sqlite", must not
  // collapse into one translation.
  it('keeps two same-basename files with no metadata name as separate translations', () => {
    const a = createRawBibleDb({}, [{ id: 1, name: 'Genesis', bookReferenceId: 1, testamentReferenceId: 1 }], [
      { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning...' },
    ], { dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-i09b-')), 'church-a') });
    const b = createRawBibleDb({}, [{ id: 1, name: 'Genesis', bookReferenceId: 1, testamentReferenceId: 1 }], [
      { bookId: 1, chapter: 1, verse: 1, text: 'In the beginning, God created...' },
    ], { dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-i09b-')), 'church-b') });

    const summaryA = importOpenlpBible(mainDb, a);
    const summaryB = importOpenlpBible(mainDb, b);

    expect(summaryA.translation).toBe('BIBLE');
    expect(summaryB.translation).toBe('BIBLE (church-b)');
    expect(listTranslations(mainDb)).toHaveLength(2);
    const genesisA = findBooksByName(mainDb, 'Genesis', summaryA.translation!)[0];
    const genesisB = findBooksByName(mainDb, 'Genesis', summaryB.translation!)[0];
    expect(getVersesForChapter(mainDb, genesisA.id, 1)[0].text).toBe('In the beginning...');
    expect(getVersesForChapter(mainDb, genesisB.id, 1)[0].text).toBe('In the beginning, God created...');
    // Re-importing the first file lands on its own translation again.
    expect(importOpenlpBible(mainDb, a).translation).toBe('BIBLE');
  });
});
