import Database from 'better-sqlite3';
import { Density, Theme } from '../../shared/types';

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

/** The translation a fresh install (and any fallback) lands on when it's installed. */
export const DEFAULT_TRANSLATION_CODE = 'KJV';

/**
 * The active translation code, falling back to KJV if present and otherwise to the first
 * installed one, so the app is never stuck pointing at a translation that was deleted
 * or never installed. Codes compare case-insensitively, like the bible_translations.code
 * column; the installed spelling is what's returned.
 */
export function getActiveTranslation(db: Database.Database, available: string[]): string | null {
  const find = (code: string | null) =>
    code == null ? undefined : available.find((c) => c.toLowerCase() === code.toLowerCase());
  return find(getSetting(db, SETTING_TRANSLATION)) ?? find(DEFAULT_TRANSLATION_CODE) ?? available[0] ?? null;
}

export const SETTING_THEME = 'theme';

/**
 * The persisted theme, defaulting to 'light' when unset or when the stored value
 * is not a recognised theme (a future version, or a corrupted setting) -- the
 * booth must never be left in an undefined state.
 */
export function getTheme(db: Database.Database): Theme {
  const stored = getSetting(db, SETTING_THEME);
  return stored === 'light' || stored === 'dark' ? stored : 'light';
}

export const SETTING_DENSITY = 'density';

/**
 * The persisted content-pane density, defaulting to 'compact' when unset or
 * unrecognised -- same fallback rule as getTheme.
 */
export function getDensity(db: Database.Database): Density {
  const stored = getSetting(db, SETTING_DENSITY);
  return stored === 'compact' || stored === 'spacious' ? stored : 'compact';
}
