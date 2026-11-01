import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applySchema } from '../../../src/main/db/schema';
import {
  bundledBiblesDir,
  listBundledCodes,
  seedBundledBibles,
  seededSettingKey,
} from '../../../src/main/content/bundledBibles';
import {
  deleteTranslation,
  findBooksByName,
  getVersesForChapter,
  listTranslations,
  upsertTranslation,
} from '../../../src/main/db/bibleRepository';
import { getSetting } from '../../../src/main/db/settingsRepository';

let db: Database.Database;
let dir: string;

// A two-verse stand-in for resources/bibles/kjv.json, so these tests stay fast.
function writeBundle(code = 'KJV', text = 'For God so loved the world.'): void {
  fs.writeFileSync(
    path.join(dir, `${code.toLowerCase()}.json`),
    JSON.stringify({
      code,
      name: 'King James Version',
      source: 'bundled',
      licenseNote: 'Public domain (US).',
      books: [{ bookCode: 'JHN', name: 'John', verses: [[3, 16, text], [3, 17, 'For God sent not his Son.']] }],
    })
  );
}

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bundled-'));
  writeBundle();
});

describe('seedBundledBibles', () => {
  it('seeds KJV into a fresh database and records the seed', () => {
    const results = seedBundledBibles(db, { dir });
    expect(results).toEqual([expect.objectContaining({ file: 'kjv.json', translation: 'KJV', imported: 2, skipped: 0 })]);
    expect(listTranslations(db)).toEqual([
      { code: 'KJV', name: 'King James Version', source: 'bundled', licenseNote: 'Public domain (US).', bookCount: 1, verseCount: 2 },
    ]);
    expect(getSetting(db, seededSettingKey('KJV'))).not.toBeNull();
  });

  it('is a no-op on a second launch', () => {
    seedBundledBibles(db, { dir });
    writeBundle('KJV', 'Changed on disk.');
    expect(seedBundledBibles(db, { dir })).toEqual([]);
    const john = findBooksByName(db, 'John', 'KJV')[0];
    expect(getVersesForChapter(db, john.id, 3)[0].text).toBe('For God so loved the world.');
  });

  it('does not bring back a KJV the operator deleted', () => {
    seedBundledBibles(db, { dir });
    deleteTranslation(db, 'KJV');
    expect(seedBundledBibles(db, { dir })).toEqual([]);
    expect(listTranslations(db)).toEqual([]);
  });

  it('restores it with force', () => {
    seedBundledBibles(db, { dir });
    deleteTranslation(db, 'KJV');
    expect(seedBundledBibles(db, { dir, force: true, code: 'kjv' })).toHaveLength(1);
    expect(listTranslations(db).map((t) => t.code)).toEqual(['KJV']);
  });

  it('never overwrites an existing OpenLP-sourced KJV without force', () => {
    upsertTranslation(db, {
      code: 'KJV',
      name: 'KJV',
      source: 'openlp',
      books: [{ bookCode: 'JHN', verses: [[3, 16, 'OpenLP wording.']] }],
    });

    expect(seedBundledBibles(db, { dir })).toEqual([]);
    expect(listTranslations(db)[0]).toMatchObject({ source: 'openlp', verseCount: 1 });
    // ...and having made that call once, a later launch doesn't revisit it.
    expect(getSetting(db, seededSettingKey('KJV'))).not.toBeNull();

    seedBundledBibles(db, { dir, force: true });
    expect(listTranslations(db)[0]).toMatchObject({ source: 'bundled', verseCount: 2 });
  });

  it('only touches the requested code', () => {
    writeBundle('ASV');
    expect(seedBundledBibles(db, { dir, code: 'ASV' }).map((r) => r.translation)).toEqual(['ASV']);
    expect(listBundledCodes(dir)).toEqual(['ASV', 'KJV']);
  });

  it('refuses a bundle whose declared code does not match its file name', () => {
    fs.writeFileSync(path.join(dir, 'kjv.json'), JSON.stringify({ code: 'NIV', name: 'x', source: 'bundled', books: [] }));
    expect(() => seedBundledBibles(db, { dir })).toThrow(/declares code "NIV", expected KJV/);
  });

  it('does nothing when the bundle directory is missing', () => {
    expect(seedBundledBibles(db, { dir: path.join(dir, 'nope') })).toEqual([]);
  });
});

describe('bundledBiblesDir', () => {
  it('is <resourcesPath>/bibles when packaged', () => {
    expect(bundledBiblesDir({ packaged: true, resourcesPath: '/opt/ServiceFlow/resources' })).toBe(
      path.join('/opt/ServiceFlow/resources', 'bibles')
    );
  });

  it("is the repo's resources/bibles in development, and holds the real KJV", () => {
    const devDir = bundledBiblesDir({ packaged: false });
    expect(path.resolve(devDir)).toBe(path.resolve(__dirname, '../../../resources/bibles'));
    expect(listBundledCodes(devDir)).toContain('KJV');
  });
});
