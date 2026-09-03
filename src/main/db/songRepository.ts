import Database from 'better-sqlite3';
import { Song, SongBlock, SongSearchResult } from '../../shared/types';
import { toFtsQuery } from './fts';

// Escapes SQL LIKE metacharacters so a literal '%' or '_' typed into the browse box
// matches itself instead of acting as a wildcard (see D-10).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function rowToSong(row: any): Song {
  return { id: row.id, title: row.title, ccliNumber: row.ccli_number };
}

function rowToBlock(row: any): SongBlock {
  return { id: row.id, songId: row.song_id, label: row.label, text: row.text, displayOrder: row.display_order };
}

export function findSongsByTitle(db: Database.Database, query: string): Song[] {
  const rows = db
    .prepare(`SELECT * FROM songs WHERE title LIKE ? ESCAPE '\\' ORDER BY title LIMIT 20`)
    .all(`%${escapeLikePattern(query)}%`);
  return rows.map(rowToSong);
}

export function getBlocksForSong(db: Database.Database, songId: number): SongBlock[] {
  const rows = db.prepare(`SELECT * FROM song_blocks WHERE song_id = ? ORDER BY display_order`).all(songId);
  return rows.map(rowToBlock);
}

export function searchSongContent(db: Database.Database, query: string, limit = 25): SongSearchResult[] {
  const rows = db
    .prepare(
      `SELECT sb.*, s.title as song_title
       FROM song_blocks_fts
       JOIN song_blocks sb ON sb.id = song_blocks_fts.rowid
       JOIN songs s ON s.id = sb.song_id
       WHERE song_blocks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(toFtsQuery(query), limit) as any[];
  return rows.map((r) => ({ block: rowToBlock(r), songTitle: r.song_title }));
}

export function createSong(db: Database.Database, title: string, ccliNumber: string | null): Song {
  const info = db.prepare(`INSERT INTO songs (title, ccli_number) VALUES (?, ?)`).run(title, ccliNumber);
  const row = db.prepare(`SELECT * FROM songs WHERE id = ?`).get(info.lastInsertRowid);
  return rowToSong(row);
}

export function updateSong(db: Database.Database, id: number, title: string, ccliNumber: string | null): void {
  db.prepare(`UPDATE songs SET title = ?, ccli_number = ? WHERE id = ?`).run(title, ccliNumber, id);
}

// Cascades to song_blocks (FK ON DELETE CASCADE) and, via the D-09 triggers, song_blocks_fts.
export function deleteSong(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM songs WHERE id = ?`).run(id);
}

export function addBlock(db: Database.Database, songId: number, label: string, text: string): SongBlock {
  const maxOrder = db
    .prepare(`SELECT COALESCE(MAX(display_order), -1) as maxOrder FROM song_blocks WHERE song_id = ?`)
    .get(songId) as { maxOrder: number };
  const info = db
    .prepare(`INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (?, ?, ?, ?)`)
    .run(songId, label, text, maxOrder.maxOrder + 1);
  const row = db.prepare(`SELECT * FROM song_blocks WHERE id = ?`).get(info.lastInsertRowid);
  return rowToBlock(row);
}

export function updateBlock(db: Database.Database, id: number, label: string, text: string): void {
  db.prepare(`UPDATE song_blocks SET label = ?, text = ? WHERE id = ?`).run(label, text, id);
}

export function deleteBlock(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM song_blocks WHERE id = ?`).run(id);
}

// UNIQUE(song_id, display_order) rejects any assignment that collides with a current row, so a
// straight index-order pass can fail mid-transaction (e.g. moving block at order 2 to order 0
// while another block still sits at 0). Landing every block on a negative, non-colliding order
// first sidesteps that, then the second pass sets the real final order.
export function reorderBlocks(db: Database.Database, songId: number, orderedIds: number[]): void {
  const update = db.prepare(`UPDATE song_blocks SET display_order = ? WHERE id = ? AND song_id = ?`);
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(-(index + 1), id, songId));
    ids.forEach((id, index) => update.run(index, id, songId));
  });
  tx(orderedIds);
}
