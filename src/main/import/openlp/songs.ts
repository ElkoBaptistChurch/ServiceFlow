import path from 'path';
import Database from 'better-sqlite3';
import { ImportError, ImportResult } from '../../../shared/types';
import { importSongs, SongInput } from '../../db/songRepository';
import { parseSongLyrics, typeCodeToName } from './songXml';

// D-12: tracks, per main database and per source file path, the set of song titles this
// file produced on its last import — so a later import of the SAME file can tell "this
// title disappeared from the source" apart from "this title simply belongs to some
// other file that was never part of this one." Scoped per mainDb so tests using
// separate in-memory databases don't see each other's history.
const knownTitlesByFile = new WeakMap<Database.Database, Map<string, Set<string>>>();

/**
 * Reads an OpenLP song database, parses each song's lyrics XML and hands the result to
 * songRepository.importSongs — the only song write path (D12).
 */
export function importOpenlpSongs(mainDb: Database.Database, openlpSongsDbPath: string): ImportResult {
  const source = new Database(openlpSongsDbPath, { readonly: true, fileMustExist: true });
  let rows: any[];
  try {
    rows = source.prepare(`SELECT title, lyrics, ccli_number FROM songs`).all() as any[];
  } finally {
    source.close();
  }

  // I-12: trim so titles differing only in surrounding whitespace collide honestly
  // instead of coexisting as indistinguishable duplicates.
  rows.forEach((row) => {
    row.title = row.title == null ? '' : String(row.title).trim();
  });

  // I-01: OpenLP allows two rows with the same title (e.g. two arrangements of the
  // same hymn), but ServiceFlow's songs.title is UNIQUE — without disambiguation the
  // second row's upsert would silently replace the first row's blocks while both are
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
      candidate = row.ccli_number ? `${originalTitle} (CCLI ${row.ccli_number})` : `${originalTitle} (${occurrence})`;
      // Guarantees uniqueness even if two "distinct" rows also share a CCLI number.
      while (usedTitles.has(candidate)) candidate = `${candidate}*`;
    }
    usedTitles.add(candidate);
    row.title = candidate;
  }

  const songs: SongInput[] = [];
  const parseErrors: ImportError[] = [];
  for (const row of rows) {
    try {
      if (row.lyrics == null) {
        // Without this check, parseSongLyrics(null) throws a raw "Cannot read
        // properties of null" TypeError, meaningless to the volunteer reading the
        // import summary.
        throw new Error('song has no lyrics data');
      }
      const blocks = parseSongLyrics(row.lyrics);
      if (blocks.length === 0) throw new Error('lyrics XML contained no verse blocks');
      songs.push({
        title: row.title,
        ccliNumber: row.ccli_number ?? null,
        blocks: blocks.map((b) => ({ label: `${typeCodeToName(b.type)} ${b.label}`, text: b.text })),
      });
    } catch (err) {
      parseErrors.push({ identifier: row.title, reason: (err as Error).message });
    }
  }

  const written = importSongs(mainDb, songs);
  const result: ImportResult = {
    file: path.basename(openlpSongsDbPath),
    kind: 'songs',
    imported: written.imported,
    skipped: written.skipped + parseErrors.length,
    errors: [...parseErrors, ...written.errors],
  };

  // D-12: a title that vanished from THIS SAME source file since its last import
  // usually means it was renamed in OpenLP, not deleted from the library. The old
  // row is left alone — never auto-deleted — but the operator is told so they can
  // reconcile it (e.g. a staged item still pointing at it).
  let history = knownTitlesByFile.get(mainDb);
  if (!history) {
    history = new Map();
    knownTitlesByFile.set(mainDb, history);
  }
  const importedThisRun = new Set(written.importedTitles);
  const previousTitles = history.get(openlpSongsDbPath);
  if (previousTitles) {
    for (const oldTitle of previousTitles) {
      if (!importedThisRun.has(oldTitle)) {
        result.errors.push({
          identifier: oldTitle,
          reason: 'no longer present in this source file (kept — was it renamed in OpenLP?)',
        });
      }
    }
  }
  history.set(openlpSongsDbPath, importedThisRun);
  return result;
}
