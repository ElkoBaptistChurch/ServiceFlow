import path from 'path';
import Database from 'better-sqlite3';
import { ImportSourceSummary, Testament } from '../../shared/types';
import { normalizeForSearch } from '../db/fts';

function mapTestament(testamentReferenceId: number): Testament {
  if (testamentReferenceId === 1) return 'OT';
  if (testamentReferenceId === 2) return 'NT';
  return 'AP';
}

// I-09b: tracks, per main database, which full file path claimed a given fallback
// translation name — so two unrelated files that both lack a metadata name and happen
// to share a basename (e.g. two folders each containing "bible.sqlite") don't collapse
// into one translation bucket. Scoped per mainDb so tests using separate in-memory
// databases don't see each other's history.
const fallbackNameClaims = new WeakMap<Database.Database, Map<string, string>>();

export function importOpenlpBible(
  mainDb: Database.Database,
  openlpBibleDbPath: string
): ImportSourceSummary {
  const source = new Database(openlpBibleDbPath, { readonly: true });
  const summary: ImportSourceSummary = {
    file: path.basename(openlpBibleDbPath),
    kind: 'bible',
    imported: 0,
    skipped: 0,
    errors: [],
  };
  try {
    const meta = source.prepare(`SELECT value FROM metadata WHERE key = 'name'`).get() as
      | { value: string }
      | undefined;
    let translation: string;
    if (meta?.value != null && meta.value.trim() !== '') {
      translation = meta.value.trim();
    } else {
      const fallbackName = path.basename(openlpBibleDbPath, '.sqlite').trim();
      let claims = fallbackNameClaims.get(mainDb);
      if (!claims) {
        claims = new Map();
        fallbackNameClaims.set(mainDb, claims);
      }
      const claimedBy = claims.get(fallbackName);
      if (claimedBy && claimedBy !== openlpBibleDbPath) {
        // Two different files with no declared name both fell back to the same
        // basename — collapsing them into one translation would silently merge two
        // different bibles' verses (see I-09b). Disambiguate using the parent folder
        // name, the same detail the operator used to tell the files apart when
        // picking them.
        translation = `${fallbackName} (${path.basename(path.dirname(openlpBibleDbPath))})`;
      } else {
        translation = fallbackName;
        claims.set(fallbackName, openlpBibleDbPath);
      }
    }
    summary.translation = translation;

    const books = source
      .prepare(`SELECT id, name, book_reference_id, testament_reference_id FROM book`)
      .all() as any[];
    // Read verses before writing anything to mainDb (see D-06 below) — a structural
    // failure here (not a per-row one) must leave no partial state behind.
    const verses = source.prepare(`SELECT book_id, chapter, verse, text FROM verse`).all() as any[];

    const upsertBook = mainDb.prepare(
      `INSERT INTO bible_books (translation, source_book_id, name, testament, sort_order) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(translation, source_book_id)
       DO UPDATE SET name = excluded.name, testament = excluded.testament, sort_order = excluded.sort_order`
    );
    const getExistingBook = mainDb.prepare(
      `SELECT id, name FROM bible_books WHERE translation = ? AND source_book_id = ?`
    );
    const getVersesForBook = mainDb.prepare(`SELECT id, text FROM bible_verses WHERE book_id = ?`);
    const deleteVersesForBook = mainDb.prepare(`DELETE FROM bible_verses WHERE book_id = ?`);
    const findVerse = mainDb.prepare(
      `SELECT id, text FROM bible_verses WHERE book_id = ? AND chapter = ? AND verse = ?`
    );
    const insertVerse = mainDb.prepare(
      `INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`
    );
    const updateVerse = mainDb.prepare(`UPDATE bible_verses SET text = ? WHERE id = ?`);
    const ftsInsert = mainDb.prepare(`INSERT INTO bible_verses_fts (rowid, text) VALUES (?, ?)`);
    const ftsDelete = mainDb.prepare(
      `INSERT INTO bible_verses_fts (bible_verses_fts, rowid, text) VALUES ('delete', ?, ?)`
    );

    // Source book ids are only meaningful inside this file, so translate them once here
    // and never let one escape into the rest of the app.
    const bookIdBySourceId = new Map<number, number>();
    const bookTx = mainDb.transaction((bookRows: any[]) => {
      bookRows.forEach((b, index) => {
        try {
          if (b.id == null) {
            // Nothing to key this book's verses off of — skip it explicitly rather
            // than letting the NOT NULL constraint on source_book_id throw for us.
            throw new Error('book has a NULL id and cannot be linked to its verses');
          }
          const existing = getExistingBook.get(translation, b.id) as { id: number; name: string } | undefined;
          if (existing && b.name != null && existing.name !== b.name) {
            // D-01: the same (translation, source_book_id) now names a different book —
            // a different edition of the file (e.g. with/without the Apocrypha shifting
            // book ids), not a rename. The old ON CONFLICT DO UPDATE just renamed the
            // row in place and left its verses attached, mixing one book's text under
            // another book's name. Wipe this book's verses so the re-import starts
            // clean; the FTS delete mirrors the updated-verse-text pattern below.
            for (const v of getVersesForBook.all(existing.id) as { id: number; text: string }[]) {
              ftsDelete.run(v.id, normalizeForSearch(v.text));
            }
            deleteVersesForBook.run(existing.id);
          }
          upsertBook.run(
            translation,
            b.id,
            b.name,
            mapTestament(b.testament_reference_id),
            b.book_reference_id ?? b.id // display order; NOT a key — KJV reuses 15 twice
          );
          bookIdBySourceId.set(b.id, (getExistingBook.get(translation, b.id) as { id: number }).id);
        } catch (err) {
          // A bad book row (e.g. NULL name) must not roll back the whole transaction —
          // that would silently drop every valid book and verse in the file. Any verse
          // that references this book falls through to the "unknown source book id"
          // branch in verseTx below, so it is skipped and reported too, never attached
          // to the wrong book.
          summary.skipped += 1;
          summary.errors.push({
            identifier: b.id != null ? `book ${b.id}` : `book row ${index}`,
            reason: (err as Error).message,
          });
        }
      });
    });

    const verseTx = mainDb.transaction((verseRows: any[]) => {
      for (const v of verseRows) {
        try {
          const bookId = bookIdBySourceId.get(v.book_id);
          if (bookId == null) throw new Error(`verse references unknown source book id ${v.book_id}`);
          // SQLite's INTEGER affinity silently stores a non-numeric value (e.g. 'abc') as
          // TEXT instead of rejecting it, so a malformed chapter/verse would otherwise
          // import successfully, reach the search index, and never be reachable by
          // getVersesForChapter's numeric lookup. NULL is left to the NOT NULL
          // constraint below, which already reports it correctly.
          const chapterInvalid = v.chapter !== null && !Number.isInteger(v.chapter);
          const verseInvalid = v.verse !== null && !Number.isInteger(v.verse);
          if (chapterInvalid || verseInvalid) {
            throw new Error(
              `verse has a non-numeric chapter or verse number (chapter=${JSON.stringify(v.chapter)}, verse=${JSON.stringify(v.verse)})`
            );
          }
          const existing = findVerse.get(bookId, v.chapter, v.verse) as
            | { id: number; text: string }
            | undefined;
          if (!existing) {
            const info = insertVerse.run(bookId, v.chapter, v.verse, v.text);
            ftsInsert.run(info.lastInsertRowid, normalizeForSearch(v.text));
          } else if (existing.text !== v.text) {
            // Retract the old terms with the text as indexed, then re-index. See the
            // songs importer note: INSERT OR REPLACE would leave the old words searchable.
            ftsDelete.run(existing.id, normalizeForSearch(existing.text));
            updateVerse.run(v.text, existing.id);
            ftsInsert.run(existing.id, normalizeForSearch(v.text));
          }
          summary.imported += 1;
        } catch (err) {
          summary.skipped += 1;
          summary.errors.push({
            identifier: `${translation} ${v.book_id}:${v.chapter}:${v.verse}`,
            reason: (err as Error).message,
          });
        }
      }
    });

    // D-06: one outer transaction so a structural failure anywhere in this file's
    // import leaves mainDb exactly as it was before this file, rather than with books
    // committed and verses missing (e.g. the app was killed between the two commits).
    const importTx = mainDb.transaction(() => {
      bookTx(books);
      verseTx(verses);
    });
    importTx();
  } finally {
    source.close();
  }
  return summary;
}
