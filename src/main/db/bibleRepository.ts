import Database from 'better-sqlite3';
import {
  BibleBook,
  BibleSearchResult,
  BibleSource,
  BibleTranslation,
  BibleVerse,
  ImportResult,
  Testament,
  TranslationInput,
} from '../../shared/types';
import { bookByCode, bookCodesMatchingQuery } from '../../shared/bibleBooks';
import { toFtsQuery } from './fts';

// Escapes SQL LIKE metacharacters so a literal '%' or '_' typed into the browse box
// matches itself instead of acting as a wildcard (see D-10).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// SQLite's built-in LIKE only case-folds ASCII, so an accented book name uppercased
// by the source file (common outside English OpenLP bibles) is otherwise unsearchable
// unless the operator matches the accent's case exactly (see I-10). Registered lazily,
// once per connection — PRAGMA case_sensitive_like is deliberately not used; it only
// ever makes LIKE *more* case-sensitive.
const unicodeFoldRegistered = new WeakSet<Database.Database>();
function ensureUnicodeFold(db: Database.Database): void {
  if (unicodeFoldRegistered.has(db)) return;
  db.function('unicode_fold', { deterministic: true }, (value: unknown) =>
    value == null ? null : String(value).toLowerCase()
  );
  unicodeFoldRegistered.add(db);
}

function rowToBook(row: any): BibleBook {
  return {
    id: row.id,
    translationCode: row.translation_code,
    bookCode: row.book_code,
    name: row.name,
    testament: row.testament as Testament,
    sortOrder: row.sort_order,
  };
}

function rowToVerse(row: any): BibleVerse {
  return { id: row.id, bookId: row.book_id, chapter: row.chapter, verse: row.verse, text: row.text };
}

// ---------------------------------------------------------------------------------------
// Write path. Every Bible source — the bundled KJV, the OpenLP adapter, any future
// format — goes through upsertTranslation, so transactions, validation, upsert-never-
// delete semantics (D5) and the search index (kept in sync by the D-09 triggers) live in
// exactly one place (D12).
// ---------------------------------------------------------------------------------------

export function upsertTranslation(db: Database.Database, input: TranslationInput): ImportResult {
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (code === '') throw new Error('translation has no code');
  const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : code;
  const result: ImportResult = {
    file: code,
    kind: 'bible',
    translation: code,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  const upsertTranslationRow = db.prepare(
    `INSERT INTO bible_translations (code, name, source, license_note, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name, source = excluded.source,
       license_note = excluded.license_note, updated_at = excluded.updated_at`
  );
  const getTranslationRow = db.prepare(`SELECT id, code FROM bible_translations WHERE code = ?`);
  const upsertBook = db.prepare(
    `INSERT INTO bible_books (translation_id, book_code, name, testament, sort_order) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(translation_id, book_code)
     DO UPDATE SET name = excluded.name, testament = excluded.testament, sort_order = excluded.sort_order`
  );
  const getBookId = db.prepare(`SELECT id FROM bible_books WHERE translation_id = ? AND book_code = ?`);
  const findVerse = db.prepare(`SELECT id, text FROM bible_verses WHERE book_id = ? AND chapter = ? AND verse = ?`);
  const insertVerse = db.prepare(`INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  const updateVerse = db.prepare(`UPDATE bible_verses SET text = ? WHERE id = ?`);

  // D-06: one outer transaction, so a structural failure anywhere (not a per-row one)
  // leaves the database exactly as it was — never books committed with verses missing.
  db.transaction(() => {
    upsertTranslationRow.run(code, name, input.source, input.licenseNote ?? null, new Date().toISOString());
    const translation = getTranslationRow.get(code) as { id: number; code: string };
    // The stored spelling wins on a case-only difference ('kjv' re-importing 'KJV').
    result.translation = translation.code;

    input.books.forEach((book, index) => {
      const verses = Array.isArray(book.verses) ? book.verses : [];
      let bookId: number;
      try {
        const canonical = typeof book.bookCode === 'string' ? bookByCode(book.bookCode) : undefined;
        if (!canonical) {
          // Never guess: a book we can't place canonically would be mis-sorted or,
          // worse, captioned as some other book on air.
          throw new Error(
            `unknown book code ${JSON.stringify(book.bookCode)} (${verses.length} verse${verses.length === 1 ? '' : 's'} skipped)`
          );
        }
        const displayName =
          typeof book.name === 'string' && book.name.trim() !== '' ? book.name.trim() : canonical.name;
        upsertBook.run(translation.id, canonical.code, displayName, canonical.testament, canonical.order);
        bookId = (getBookId.get(translation.id, canonical.code) as { id: number }).id;
      } catch (err) {
        // One bad book must not roll back the rest of the translation. Its verses are
        // counted as skipped but reported once, on the book, rather than one error per
        // verse.
        result.skipped += verses.length;
        result.errors.push({
          identifier: book.bookCode ? `book ${book.bookCode}` : `book row ${index}`,
          reason: (err as Error).message,
        });
        return;
      }

      for (const tuple of verses) {
        const [chapter, verse, text] = Array.isArray(tuple) ? tuple : [undefined, undefined, undefined];
        try {
          // SQLite's INTEGER affinity silently stores a non-numeric value (e.g. 'abc') as
          // TEXT instead of rejecting it, so a malformed chapter/verse would otherwise
          // import, reach the search index, and never be reachable by
          // getVersesForChapter's numeric lookup. Verse 0 is real (KJV's Sirach 1:0
          // prologue) and is kept.
          if (!Number.isInteger(chapter) || !Number.isInteger(verse)) {
            throw new Error(
              `verse has a non-numeric chapter or verse number (chapter=${JSON.stringify(chapter)}, verse=${JSON.stringify(verse)})`
            );
          }
          if (typeof text !== 'string' || text.trim() === '') throw new Error('verse has no text');
          const existing = findVerse.get(bookId, chapter, verse) as { id: number; text: string } | undefined;
          if (!existing) {
            insertVerse.run(bookId, chapter, verse, text);
          } else if (existing.text !== text) {
            updateVerse.run(text, existing.id);
          }
          // D5: verses absent from this input are left alone, never deleted.
          result.imported += 1;
        } catch (err) {
          result.skipped += 1;
          result.errors.push({
            identifier: `${code} ${book.bookCode} ${chapter}:${verse}`,
            reason: (err as Error).message,
          });
        }
      }
    });
  })();

  return result;
}

/**
 * Removes a translation, its books and verses (FK cascade; the FTS rows follow via the
 * D-09 triggers). Returns the removed book ids so the caller can unstage anything that
 * referenced them — staged_items.ref_id is polymorphic and has no FK to cascade through.
 */
export function deleteTranslation(db: Database.Database, code: string): { removedBookIds: number[] } {
  return db.transaction(() => {
    const translation = db.prepare(`SELECT id FROM bible_translations WHERE code = ?`).get(code) as
      | { id: number }
      | undefined;
    if (!translation) return { removedBookIds: [] };
    const removedBookIds = (
      db.prepare(`SELECT id FROM bible_books WHERE translation_id = ?`).all(translation.id) as { id: number }[]
    ).map((r) => r.id);
    db.prepare(`DELETE FROM bible_translations WHERE id = ?`).run(translation.id);
    return { removedBookIds };
  })();
}

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

export function listTranslations(db: Database.Database): BibleTranslation[] {
  const rows = db
    .prepare(
      `SELECT t.code, t.name, t.source, t.license_note,
              (SELECT COUNT(*) FROM bible_books b WHERE b.translation_id = t.id) AS book_count,
              (SELECT COUNT(*) FROM bible_verses v JOIN bible_books b ON b.id = v.book_id
                WHERE b.translation_id = t.id) AS verse_count
       FROM bible_translations t
       ORDER BY t.code COLLATE NOCASE`
    )
    .all() as any[];
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    source: r.source as BibleSource,
    licenseNote: r.license_note,
    bookCount: r.book_count,
    verseCount: r.verse_count,
  }));
}

export function listTranslationCodes(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT code FROM bible_translations ORDER BY code COLLATE NOCASE`).all() as { code: string }[]
  ).map((r) => r.code);
}

/**
 * Books in one translation whose name contains `query` — or whose canonical name or an
 * alias does, so "Song of Songs" finds SNG whatever this translation calls it.
 */
export function findBooksByName(db: Database.Database, query: string, translationCode: string): BibleBook[] {
  ensureUnicodeFold(db);
  const rows = db
    .prepare(
      `SELECT b.*, t.code AS translation_code
       FROM bible_books b JOIN bible_translations t ON t.id = b.translation_id
       WHERE t.code = ?
         AND (unicode_fold(b.name) LIKE unicode_fold(?) ESCAPE '\\'
              OR b.book_code IN (SELECT value FROM json_each(?)))
       ORDER BY b.sort_order LIMIT 20`
    )
    .all(translationCode, `%${escapeLikePattern(query)}%`, JSON.stringify(bookCodesMatchingQuery(query)));
  return rows.map(rowToBook);
}

// bookId is always ServiceFlow's own bible_books.id, which already carries the
// translation — so no query below can mix two translations by accident.
export function getChaptersForBook(db: Database.Database, bookId: number): number[] {
  const rows = db
    .prepare(`SELECT DISTINCT chapter FROM bible_verses WHERE book_id = ? ORDER BY chapter`)
    .all(bookId) as { chapter: number }[];
  return rows.map((r) => r.chapter);
}

export function getVersesForChapter(db: Database.Database, bookId: number, chapter: number): BibleVerse[] {
  const rows = db
    .prepare(`SELECT * FROM bible_verses WHERE book_id = ? AND chapter = ? ORDER BY verse`)
    .all(bookId, chapter);
  return rows.map(rowToVerse);
}

export function searchBibleContent(
  db: Database.Database,
  query: string,
  translationCode: string,
  limit = 25
): BibleSearchResult[] {
  const rows = db
    .prepare(
      `SELECT bv.*, bb.name AS book_name, t.code AS translation_code
       FROM bible_verses_fts
       JOIN bible_verses bv ON bv.id = bible_verses_fts.rowid
       JOIN bible_books bb ON bb.id = bv.book_id
       JOIN bible_translations t ON t.id = bb.translation_id
       WHERE bible_verses_fts MATCH ? AND t.code = ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(toFtsQuery(query), translationCode, limit) as any[];
  return rows.map((r) => ({ verse: rowToVerse(r), bookName: r.book_name, translation: r.translation_code }));
}
