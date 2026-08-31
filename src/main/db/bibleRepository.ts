import Database from 'better-sqlite3';
import { BibleBook, BibleSearchResult, BibleVerse, Testament } from '../../shared/types';
import { toFtsQuery } from './fts';

function rowToBook(row: any): BibleBook {
  return {
    id: row.id,
    translation: row.translation,
    sourceBookId: row.source_book_id,
    name: row.name,
    testament: row.testament as Testament,
    sortOrder: row.sort_order,
  };
}

function rowToVerse(row: any): BibleVerse {
  return { id: row.id, bookId: row.book_id, chapter: row.chapter, verse: row.verse, text: row.text };
}

export function listTranslations(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT translation FROM bible_books ORDER BY translation`)
    .all() as { translation: string }[];
  return rows.map((r) => r.translation);
}

export function findBooksByName(db: Database.Database, query: string, translation: string): BibleBook[] {
  const rows = db
    .prepare(`SELECT * FROM bible_books WHERE translation = ? AND name LIKE ? ORDER BY sort_order LIMIT 20`)
    .all(translation, `%${query}%`);
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

export function searchBibleContent(db: Database.Database, query: string, translation: string, limit = 25): BibleSearchResult[] {
  const rows = db
    .prepare(
      `SELECT bv.*, bb.name as book_name, bb.translation as translation
       FROM bible_verses_fts
       JOIN bible_verses bv ON bv.id = bible_verses_fts.rowid
       JOIN bible_books bb ON bb.id = bv.book_id
       WHERE bible_verses_fts MATCH ? AND bb.translation = ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(toFtsQuery(query), translation, limit) as any[];
  return rows.map((r) => ({ verse: rowToVerse(r), bookName: r.book_name, translation: r.translation }));
}
