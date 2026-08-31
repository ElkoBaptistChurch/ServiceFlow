import Database from 'better-sqlite3';
import { applySchema } from './schema';

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  applySchema(db);
  return db;
}
