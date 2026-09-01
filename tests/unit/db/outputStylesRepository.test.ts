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

  // D-02: a global COUNT(*) guard means a style added to DEFAULT_STYLES after release
  // never reaches an install that already seeded its first three bible presets.
  it('seeds a newly added default style into an existing database', () => {
    const insert = db.prepare(
      `INSERT INTO output_styles (content_type, name, template_key, settings, is_active) VALUES (?, ?, ?, '{}', ?)`
    );
    insert.run('bible', 'Classic Lower Third', 'bible-classic', 1);
    insert.run('bible', 'Minimal Caption', 'bible-minimal', 0);
    insert.run('bible', 'Bold Banner', 'bible-bold', 0);

    seedDefaultOutputStyles(db);

    const styles = getStyles(db, 'bible');
    expect(styles.map((s) => s.templateKey)).toContain('bible-centered');
    expect(styles).toHaveLength(4);
    // The pre-existing active style must be undisturbed by the newly-seeded preset.
    expect(getActiveStyle(db, 'bible')?.templateKey).toBe('bible-classic');
  });

  // M-12: the second UPDATE in setActiveStyle matches zero rows for a styleId from the
  // wrong content type, which previously committed anyway and left nothing active.
  it('rejects a style id from the wrong content type', () => {
    seedDefaultOutputStyles(db);
    const songStyleId = getStyles(db, 'song')[0].id;
    expect(() => setActiveStyle(db, 'bible', songStyleId)).toThrow();
    // The transaction must have rolled back — bible's original active style still holds.
    expect(getActiveStyle(db, 'bible')?.templateKey).toBe('bible-classic');
  });
});
