import Database from 'better-sqlite3';
import { Song, SongBlock, SongSearchResult } from '../../shared/types';
import { toFtsQuery } from './fts';

function rowToSong(row: any): Song {
  return { id: row.id, title: row.title, ccliNumber: row.ccli_number };
}

function rowToBlock(row: any): SongBlock {
  return { id: row.id, songId: row.song_id, label: row.label, text: row.text, displayOrder: row.display_order };
}

export function findSongsByTitle(db: Database.Database, query: string): Song[] {
  const rows = db.prepare(`SELECT * FROM songs WHERE title LIKE ? ORDER BY title LIMIT 20`).all(`%${query}%`);
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
