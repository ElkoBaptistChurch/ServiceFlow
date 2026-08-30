import path from 'path';
import Database from 'better-sqlite3';
import { ImportSourceSummary } from '../../shared/types';
import { normalizeForSearch } from '../db/fts';
import { parseSongLyrics, typeCodeToName } from './songXml';

export function importOpenlpSongs(
  mainDb: Database.Database,
  openlpSongsDbPath: string
): ImportSourceSummary {
  const source = new Database(openlpSongsDbPath, { readonly: true });
  const summary: ImportSourceSummary = {
    file: path.basename(openlpSongsDbPath),
    kind: 'songs',
    imported: 0,
    skipped: 0,
    errors: [],
  };
  try {
    const rows = source.prepare(`SELECT title, lyrics, ccli_number FROM songs`).all() as any[];

    const upsertSong = mainDb.prepare(
      `INSERT INTO songs (title, ccli_number) VALUES (?, ?)
       ON CONFLICT(title) DO UPDATE SET ccli_number = excluded.ccli_number`
    );
    const getSongId = mainDb.prepare(`SELECT id FROM songs WHERE title = ?`);
    // Blocks are replaced wholesale rather than upserted: a (type,label) pair can repeat
    // within one song, and a re-import must also drop blocks deleted in OpenLP.
    const existingBlocks = mainDb.prepare(`SELECT id, text FROM song_blocks WHERE song_id = ?`);
    const deleteFtsRow = mainDb.prepare(
      `INSERT INTO song_blocks_fts (song_blocks_fts, rowid, text) VALUES ('delete', ?, ?)`
    );
    const deleteBlocks = mainDb.prepare(`DELETE FROM song_blocks WHERE song_id = ?`);
    const insertBlock = mainDb.prepare(
      `INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (?, ?, ?, ?)`
    );
    const insertFts = mainDb.prepare(`INSERT INTO song_blocks_fts (rowid, text) VALUES (?, ?)`);

    const tx = mainDb.transaction((songRows: any[]) => {
      for (const row of songRows) {
        try {
          const blocks = parseSongLyrics(row.lyrics);
          if (blocks.length === 0) {
            throw new Error('lyrics XML contained no verse blocks');
          }
          upsertSong.run(row.title, row.ccli_number ?? null);
          const songId = (getSongId.get(row.title) as { id: number }).id;
          // The FTS 'delete' command must be given the text exactly as it was INDEXED,
          // i.e. the normalized copy — not the raw stored text.
          for (const old of existingBlocks.all(songId) as { id: number; text: string }[]) {
            deleteFtsRow.run(old.id, normalizeForSearch(old.text));
          }
          deleteBlocks.run(songId);
          blocks.forEach((block, index) => {
            const label = `${typeCodeToName(block.type)} ${block.label}`;
            const info = insertBlock.run(songId, label, block.text, index);
            // Index a punctuation-normalized copy; the displayed text keeps its own quotes.
            insertFts.run(info.lastInsertRowid, normalizeForSearch(block.text));
          });
          summary.imported += 1;
        } catch (err) {
          summary.skipped += 1;
          summary.errors.push({ identifier: row.title, reason: (err as Error).message });
        }
      }
    });
    tx(rows);
  } finally {
    source.close();
  }
  return summary;
}
