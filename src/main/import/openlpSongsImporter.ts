import path from 'path';
import Database from 'better-sqlite3';
import { ImportSourceSummary } from '../../shared/types';
import { parseSongLyrics, typeCodeToName } from './songXml';

// D-12: tracks, per main database and per source file path, the set of song titles this
// file produced on its last import — so a later import of the SAME file can tell "this
// title disappeared from the source" apart from "this title simply belongs to some
// other file that was never part of this one." Scoped per mainDb so tests using
// separate in-memory databases don't see each other's history.
const knownTitlesByFile = new WeakMap<Database.Database, Map<string, Set<string>>>();

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

    // I-12: trim so titles differing only in surrounding whitespace collide honestly
    // instead of coexisting as indistinguishable duplicates.
    rows.forEach((row) => {
      row.title = String(row.title).trim();
    });

    // I-01: OpenLP allows two rows with the same title (e.g. two arrangements of the
    // same hymn), but this app's songs.title is UNIQUE — without disambiguation the
    // second row's upsert would silently delete the first row's blocks while both are
    // still reported as imported. Give every row after the first a unique title,
    // preferring the CCLI number (a real-world stable identifier) over a bare ordinal.
    const usedTitles = new Set<string>();
    const occurrences = new Map<string, number>();
    for (const row of rows) {
      const originalTitle = row.title;
      const occurrence = (occurrences.get(originalTitle) ?? 0) + 1;
      occurrences.set(originalTitle, occurrence);
      let candidate = originalTitle;
      if (occurrence > 1) {
        candidate = row.ccli_number
          ? `${originalTitle} (CCLI ${row.ccli_number})`
          : `${originalTitle} (${occurrence})`;
        // Guarantees uniqueness even if two "distinct" rows also share a CCLI number.
        while (usedTitles.has(candidate)) candidate = `${candidate}*`;
      }
      usedTitles.add(candidate);
      row.title = candidate;
    }

    const upsertSong = mainDb.prepare(
      `INSERT INTO songs (title, ccli_number) VALUES (?, ?)
       ON CONFLICT(title) DO UPDATE SET ccli_number = excluded.ccli_number`
    );
    const getSongId = mainDb.prepare(`SELECT id FROM songs WHERE title = ?`);
    // Blocks are replaced wholesale rather than upserted: a (type,label) pair can repeat
    // within one song, and a re-import must also drop blocks deleted in OpenLP.
    // D-09: song_blocks_fts is kept in sync by triggers (schema.ts migration 3), not
    // by hand here — deleteBlocks/insertBlock alone is sufficient.
    const deleteBlocks = mainDb.prepare(`DELETE FROM song_blocks WHERE song_id = ?`);
    const insertBlock = mainDb.prepare(
      `INSERT INTO song_blocks (song_id, label, text, display_order) VALUES (?, ?, ?, ?)`
    );

    const importedTitlesThisRun = new Set<string>();
    const tx = mainDb.transaction((songRows: any[]) => {
      for (const row of songRows) {
        try {
          if (row.lyrics == null) {
            // Without this check, parseSongLyrics(null) throws a raw
            // "Cannot read properties of null" TypeError, which is meaningless to
            // the church volunteer reading the import summary.
            throw new Error('song has no lyrics data');
          }
          const blocks = parseSongLyrics(row.lyrics);
          if (blocks.length === 0) {
            throw new Error('lyrics XML contained no verse blocks');
          }
          upsertSong.run(row.title, row.ccli_number ?? null);
          const songId = (getSongId.get(row.title) as { id: number }).id;
          deleteBlocks.run(songId);
          blocks.forEach((block, index) => {
            const label = `${typeCodeToName(block.type)} ${block.label}`;
            insertBlock.run(songId, label, block.text, index);
          });
          summary.imported += 1;
          importedTitlesThisRun.add(row.title);
        } catch (err) {
          summary.skipped += 1;
          summary.errors.push({ identifier: row.title, reason: (err as Error).message });
        }
      }
    });
    tx(rows);

    // D-12: a title that vanished from THIS SAME source file since its last import
    // usually means it was renamed in OpenLP, not deleted from the library. The old
    // row is left alone — never auto-deleted — but the operator is told so they can
    // reconcile it (e.g. a staged item still pointing at it).
    let history = knownTitlesByFile.get(mainDb);
    if (!history) {
      history = new Map();
      knownTitlesByFile.set(mainDb, history);
    }
    const previousTitles = history.get(openlpSongsDbPath);
    if (previousTitles) {
      for (const oldTitle of previousTitles) {
        if (!importedTitlesThisRun.has(oldTitle)) {
          summary.errors.push({
            identifier: oldTitle,
            reason: 'no longer present in this source file (kept — was it renamed in OpenLP?)',
          });
        }
      }
    }
    history.set(openlpSongsDbPath, importedTitlesThisRun);
  } finally {
    source.close();
  }
  return summary;
}
