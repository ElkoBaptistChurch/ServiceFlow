import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  getSetting,
  setSetting,
  getActiveTranslation,
  SETTING_TRANSLATION,
  getTheme,
  SETTING_THEME,
} from '../../../src/main/db/settingsRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('settingsRepository', () => {
  it('returns null for a key that has never been set', () => {
    expect(getSetting(db, 'nonexistent')).toBeNull();
  });

  it('round-trips a setting through set and get, upserting on repeated writes', () => {
    setSetting(db, 'foo', 'bar');
    expect(getSetting(db, 'foo')).toBe('bar');
    setSetting(db, 'foo', 'baz');
    expect(getSetting(db, 'foo')).toBe('baz');
  });

  describe('getActiveTranslation', () => {
    it('falls back to the first available translation when nothing is stored', () => {
      expect(getActiveTranslation(db, ['KJV', 'NIV'])).toBe('KJV');
    });

    it('returns the stored translation when it is still available', () => {
      setSetting(db, SETTING_TRANSLATION, 'NIV');
      expect(getActiveTranslation(db, ['KJV', 'NIV'])).toBe('NIV');
    });
  });

  describe('getTheme', () => {
    // The booth-safe default: an operator who has never opened Settings, or whose
    // stored value predates this feature, should get a bright default rather than
    // an unexplained crash or an unstyled window.
    it('defaults to light when no theme is stored', () => {
      expect(getTheme(db)).toBe('light');
    });

    it('returns the stored theme when it is a recognised value', () => {
      setSetting(db, SETTING_THEME, 'dark');
      expect(getTheme(db)).toBe('dark');
    });

    // A stored value that is neither 'light' nor 'dark' (a future theme name, or a
    // corrupted row) must not propagate into the UI or crash startup -- fall back
    // to light exactly as if the setting were unset.
    it('defaults to light when the stored value is not a recognised theme', () => {
      setSetting(db, SETTING_THEME, 'solarized');
      expect(getTheme(db)).toBe('light');
    });

    it('persists a theme change and reads it back', () => {
      setSetting(db, SETTING_THEME, 'dark');
      expect(getTheme(db)).toBe('dark');
      setSetting(db, SETTING_THEME, 'light');
      expect(getTheme(db)).toBe('light');
    });
  });
});
