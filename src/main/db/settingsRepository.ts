import Database from 'better-sqlite3';

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export const SETTING_TRANSLATION = 'translation';

/**
 * The active translation, falling back to the first imported one so the app is
 * never stuck pointing at a translation the operator never imported.
 */
export function getActiveTranslation(db: Database.Database, available: string[]): string | null {
  const stored = getSetting(db, SETTING_TRANSLATION);
  if (stored && available.includes(stored)) return stored;
  return available[0] ?? null;
}
