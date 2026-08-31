import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import {
  getActiveStyle,
  getStyles,
  seedDefaultOutputStyles,
  setActiveStyle,
} from '../../../src/main/db/outputStylesRepository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('outputStylesRepository', () => {
  it('seeds four presets per content type with the first active', () => {
    seedDefaultOutputStyles(db);
    const bibleStyles = getStyles(db, 'bible');
    const songStyles = getStyles(db, 'song');
    expect(bibleStyles).toHaveLength(4);
    expect(songStyles).toHaveLength(4);
    expect(getActiveStyle(db, 'bible')?.name).toBe(bibleStyles[0].name);
    expect(getActiveStyle(db, 'song')?.name).toBe(songStyles[0].name);
  });

  it('is idempotent — seeding twice does not duplicate rows', () => {
    seedDefaultOutputStyles(db);
    seedDefaultOutputStyles(db);
    expect(getStyles(db, 'bible')).toHaveLength(4);
  });

  it('changes the active style for a content type', () => {
    seedDefaultOutputStyles(db);
    const styles = getStyles(db, 'bible');
    setActiveStyle(db, 'bible', styles[2].id);
    expect(getActiveStyle(db, 'bible')?.id).toBe(styles[2].id);
    expect(getStyles(db, 'song').filter((s) => s.isActive)).toHaveLength(1);
  });
});
