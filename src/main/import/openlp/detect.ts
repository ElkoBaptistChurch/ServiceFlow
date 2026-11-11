import Database from 'better-sqlite3';

export type OpenlpFileKind = 'songs' | 'bible' | 'unknown';

export function detectOpenlpFile(filePath: string): OpenlpFileKind {
  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const tables = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
        (r) => r.name
      )
    );
    if (tables.has('songs')) return 'songs';
    if (tables.has('verse') && tables.has('book')) return 'bible';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    db?.close();
  }
}
