import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function createFixtureSongsDb(
  songs: { title: string; lyrics: string; ccliNumber?: string | null }[]
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-songs-')), 'songs.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE songs (
      id INTEGER NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      lyrics TEXT NOT NULL,
      ccli_number VARCHAR(64)
    );
  `);
  const insert = db.prepare(`INSERT INTO songs (title, lyrics, ccli_number) VALUES (?, ?, ?)`);
  songs.forEach((s) => insert.run(s.title, s.lyrics, s.ccliNumber ?? null));
  db.close();
  return dbPath;
}

export function createFixtureBibleDb(
  translationName: string,
  // bookReferenceId defaults to id, but tests MUST be able to set it independently:
  // in the real KJV file, book id 44 (Romans) carries book_reference_id 45.
  books: { id: number; name: string; testamentReferenceId: number; bookReferenceId?: number }[],
  verses: { bookId: number; chapter: number; verse: number; text: string }[]
): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-')), 'bible.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER NOT NULL PRIMARY KEY, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
  `);
  db.prepare(`INSERT INTO metadata (key, value) VALUES ('name', ?)`).run(translationName);
  const insertBook = db.prepare(
    `INSERT INTO book (id, book_reference_id, testament_reference_id, name) VALUES (?, ?, ?, ?)`
  );
  books.forEach((b) => insertBook.run(b.id, b.bookReferenceId ?? b.id, b.testamentReferenceId, b.name));
  const insertVerse = db.prepare(`INSERT INTO verse (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  verses.forEach((v) => insertVerse.run(v.bookId, v.chapter, v.verse, v.text));
  db.close();
  return dbPath;
}
