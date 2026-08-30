import path from 'path';
import Database from 'better-sqlite3';
import { ImportSourceSummary, Testament } from '../../shared/types';
import { normalizeForSearch } from '../db/fts';

function mapTestament(testamentReferenceId: number): Testament {
  if (testamentReferenceId === 1) return 'OT';
  if (testamentReferenceId === 2) return 'NT';
  return 'AP';
}

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
    const translation = (meta?.value ?? path.basename(openlpBibleDbPath, '.sqlite')).trim();
    summary.translation = translation;

    const books = source
      .prepare(`SELECT id, name, book_reference_id, testament_reference_id FROM book`)
      .all() as any[];
    const upsertBook = mainDb.prepare(
      `INSERT INTO bible_books (translation, source_book_id, name, testament, sort_order) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(translation, source_book_id)
       DO UPDATE SET name = excluded.name, testament = excluded.testament, sort_order = excluded.sort_order`
    );
    const getBookId = mainDb.prepare(
      `SELECT id FROM bible_books WHERE translation = ? AND source_book_id = ?`
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
          upsertBook.run(
            translation,
            b.id,
            b.name,
            mapTestament(b.testament_reference_id),
            b.book_reference_id ?? b.id // display order; NOT a key — KJV reuses 15 twice
          );
          bookIdBySourceId.set(b.id, (getBookId.get(translation, b.id) as { id: number }).id);
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
    bookTx(books);

    const verses = source.prepare(`SELECT book_id, chapter, verse, text FROM verse`).all() as any[];
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
    verseTx(verses);
  } finally {
    source.close();
  }
  return summary;
}
