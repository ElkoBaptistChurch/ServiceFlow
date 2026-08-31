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
    db.prepare(`UPDATE output_styles SET is_active = 1 WHERE id = ? AND content_type = ?`).run(styleId, contentType);
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
  const existing = db.prepare(`SELECT COUNT(*) as count FROM output_styles`).get() as { count: number };
  if (existing.count > 0) return;
  const insert = db.prepare(
    `INSERT INTO output_styles (content_type, name, template_key, settings, is_active) VALUES (?, ?, ?, '{}', ?)`
  );
  const tx = db.transaction(() => {
    const seenTypes = new Set<ContentType>();
    for (const style of DEFAULT_STYLES) {
      const isFirstOfType = !seenTypes.has(style.contentType);
      seenTypes.add(style.contentType);
      insert.run(style.contentType, style.name, style.templateKey, isFirstOfType ? 1 : 0);
    }
  });
  tx();
}
