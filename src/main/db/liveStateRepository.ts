import Database from 'better-sqlite3';
import { LiveState } from '../../shared/types';

/**
 * The single place that turns (staged item, verse/block) into words a human reads.
 * The operator banner, the OBS payload and the tests all go through here, so the
 * UI can never drift into showing raw row ids.
 */
export function describeLiveReference(
  db: Database.Database,
  stagedItemId: number | null,
  verseOrBlockId: number | null
): string | null {
  if (stagedItemId == null || verseOrBlockId == null) return null;
  const item = db.prepare(`SELECT type FROM staged_items WHERE id = ?`).get(stagedItemId) as
    | { type: string }
    | undefined;
  if (!item) return null;
  if (item.type === 'bible') {
    const row = db
      .prepare(
        `SELECT bb.name, bv.chapter, bv.verse FROM bible_verses bv JOIN bible_books bb ON bb.id = bv.book_id WHERE bv.id = ?`
      )
      .get(verseOrBlockId) as { name: string; chapter: number; verse: number } | undefined;
    return row ? `${row.name} ${row.chapter}:${row.verse}` : null;
  }
  const row = db
    .prepare(`SELECT s.title, sb.label FROM song_blocks sb JOIN songs s ON s.id = sb.song_id WHERE sb.id = ?`)
    .get(verseOrBlockId) as { title: string; label: string } | undefined;
  return row ? `${row.title} — ${row.label}` : null;
}

function rowToLiveState(db: Database.Database, row: any): LiveState {
  return {
    stagedItemId: row.staged_item_id,
    verseOrBlockId: row.verse_or_block_id,
    styleId: row.style_id,
    hidden: !!row.hidden,
    updatedAt: row.updated_at,
    reference: describeLiveReference(db, row.staged_item_id, row.verse_or_block_id),
  };
}

export function getLiveState(db: Database.Database): LiveState {
  const row = db.prepare(`SELECT * FROM live_state WHERE id = 1`).get();
  // The singleton row can't reach 2 rows (CHECK (id = 1) plus INSERT OR IGNORE seeding),
  // but 0 rows is reachable via a migration that recreates the table — fail soft rather
  // than throwing a raw TypeError on row.staged_item_id.
  if (!row) {
    return {
      stagedItemId: null,
      verseOrBlockId: null,
      styleId: null,
      hidden: false,
      updatedAt: new Date(0).toISOString(),
      reference: null,
    };
  }
  return rowToLiveState(db, row);
}

export function setLiveState(
  db: Database.Database,
  stagedItemId: number | null,
  verseOrBlockId: number | null,
  styleId: number | null
): LiveState {
  const updatedAt = new Date().toISOString();
  // Choosing something new always un-blanks: the operator's intent is unambiguous.
  db.prepare(
    `UPDATE live_state SET staged_item_id = ?, verse_or_block_id = ?, style_id = ?, hidden = 0, updated_at = ? WHERE id = 1`
  ).run(stagedItemId, verseOrBlockId, styleId, updatedAt);
  return getLiveState(db);
}

/** Blank/restore the OBS output while keeping the current selection. */
export function setOutputHidden(db: Database.Database, hidden: boolean): LiveState {
  db.prepare(`UPDATE live_state SET hidden = ?, updated_at = ? WHERE id = 1`).run(
    hidden ? 1 : 0,
    new Date().toISOString()
  );
  return getLiveState(db);
}

/** Used when the staged item that was live is removed. */
export function clearLiveState(db: Database.Database): LiveState {
  return setLiveState(db, null, null, null);
}

/**
 * Drops the live selection without touching `hidden` — used at startup once the staged
 * list is wiped, so the live pointer can't dangle on a now-deleted staged item. Unlike
 * clearLiveState, this must not un-blank output that was deliberately left hidden.
 */
export function clearLiveSelection(db: Database.Database): LiveState {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE live_state SET staged_item_id = NULL, verse_or_block_id = NULL, style_id = NULL, updated_at = ? WHERE id = 1`
  ).run(updatedAt);
  return getLiveState(db);
}
