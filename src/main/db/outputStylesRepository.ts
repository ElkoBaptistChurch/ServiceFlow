import Database from 'better-sqlite3';
import { ContentType, OutputStyle } from '../../shared/types';

function rowToStyle(row: any): OutputStyle {
  return {
    id: row.id,
    contentType: row.content_type,
    name: row.name,
    templateKey: row.template_key,
    settings: JSON.parse(row.settings),
    isActive: !!row.is_active,
  };
}

export function getStyles(db: Database.Database, contentType: ContentType): OutputStyle[] {
  const rows = db.prepare(`SELECT * FROM output_styles WHERE content_type = ? ORDER BY id`).all(contentType);
  return rows.map(rowToStyle);
}

export function getActiveStyle(db: Database.Database, contentType: ContentType): OutputStyle | undefined {
  const row = db.prepare(`SELECT * FROM output_styles WHERE content_type = ? AND is_active = 1`).get(contentType);
  return row ? rowToStyle(row) : undefined;
}

export function setActiveStyle(db: Database.Database, contentType: ContentType, styleId: number): void {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE output_styles SET is_active = 0 WHERE content_type = ?`).run(contentType);
    const result = db
      .prepare(`UPDATE output_styles SET is_active = 1 WHERE id = ? AND content_type = ?`)
      .run(styleId, contentType);
    // A styleId from the wrong content type (or a nonexistent one) matches zero rows here,
    // which would otherwise commit with every style of this content type inactive.
    if (result.changes !== 1) {
      throw new Error(`no ${contentType} style with id ${styleId}`);
    }
  });
  tx();
}

const DEFAULT_STYLES: { contentType: ContentType; name: string; templateKey: string }[] = [
  { contentType: 'bible', name: 'Classic Lower Third', templateKey: 'bible-classic' },
  { contentType: 'bible', name: 'Minimal Caption', templateKey: 'bible-minimal' },
  { contentType: 'bible', name: 'Bold Banner', templateKey: 'bible-bold' },
  { contentType: 'bible', name: 'Centered Full', templateKey: 'bible-centered' },
  { contentType: 'song', name: 'Classic Lower Third', templateKey: 'song-classic' },
  { contentType: 'song', name: 'Minimal Caption', templateKey: 'song-minimal' },
  { contentType: 'song', name: 'Bold Banner', templateKey: 'song-bold' },
  { contentType: 'song', name: 'Centered Full', templateKey: 'song-centered' },
];

export function seedDefaultOutputStyles(db: Database.Database): void {
  // Guarding on a global COUNT(*) means a style added to DEFAULT_STYLES in a later
  // release never reaches an existing install, since the very first seed already made
  // the count positive. Guard per style key instead, so new presets still land.
  const existingKeys = new Set(
    (db.prepare(`SELECT template_key FROM output_styles`).all() as { template_key: string }[]).map(
      (r) => r.template_key
    )
  );
  const hasAnyOfType = new Set(
    (db.prepare(`SELECT DISTINCT content_type FROM output_styles`).all() as { content_type: ContentType }[]).map(
      (r) => r.content_type
    )
  );
  const insert = db.prepare(
    `INSERT INTO output_styles (content_type, name, template_key, settings, is_active) VALUES (?, ?, ?, '{}', ?)`
  );
  const tx = db.transaction(() => {
    for (const style of DEFAULT_STYLES) {
      if (existingKeys.has(style.templateKey)) continue;
      const isFirstOfType = !hasAnyOfType.has(style.contentType);
      hasAnyOfType.add(style.contentType);
      insert.run(style.contentType, style.name, style.templateKey, isFirstOfType ? 1 : 0);
    }
  });
  tx();
}
