import Database from 'better-sqlite3';
import { StagedItem, StagedItemType } from '../../shared/types';

function labelFor(db: Database.Database, type: StagedItemType, refId: number, chapter: number | null): string {
  if (type === 'bible') {
    // refId is a bible_books.id, so the translation comes along for free — and showing
    // it makes a wrong-translation mistake visible before it reaches the stream.
    const book = db.prepare(`SELECT name, translation FROM bible_books WHERE id = ?`).get(refId) as
      | { name: string; translation: string }
      | undefined;
    return book ? `${book.name} ${chapter} (${book.translation})` : `Unknown ${chapter}`;
  }
  const song = db.prepare(`SELECT title FROM songs WHERE id = ?`).get(refId) as { title: string } | undefined;
  return song ? song.title : 'Unknown Song';
}

function rowToStagedItem(db: Database.Database, row: any): StagedItem {
  return {
    id: row.id,
    type: row.type,
    refId: row.ref_id,
    chapter: row.chapter,
    position: row.position,
    label: labelFor(db, row.type, row.ref_id, row.chapter),
  };
}

export function getStagedItems(db: Database.Database): StagedItem[] {
  const rows = db.prepare(`SELECT * FROM staged_items ORDER BY position`).all();
  return rows.map((r) => rowToStagedItem(db, r));
}

export function addStagedItem(db: Database.Database, type: StagedItemType, refId: number, chapter: number | null): StagedItem {
  const maxPos = db.prepare(`SELECT COALESCE(MAX(position), -1) as maxPos FROM staged_items`).get() as { maxPos: number };
  const info = db
    .prepare(`INSERT INTO staged_items (type, ref_id, chapter, position) VALUES (?, ?, ?, ?)`)
    .run(type, refId, chapter, maxPos.maxPos + 1);
  const row = db.prepare(`SELECT * FROM staged_items WHERE id = ?`).get(info.lastInsertRowid);
  return rowToStagedItem(db, row);
}

export function removeStagedItem(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM staged_items WHERE id = ?`).run(id);
}

export function reorderStagedItems(db: Database.Database, orderedIds: number[]): void {
  const update = db.prepare(`UPDATE staged_items SET position = ? WHERE id = ?`);
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  tx(orderedIds);
}
