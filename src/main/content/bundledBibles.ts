import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { ImportResult, TranslationInput } from '../../shared/types';
import { upsertTranslation } from '../db/bibleRepository';
import { getSetting, setSetting } from '../db/settingsRepository';

/**
 * Where the bundled Bible JSON files live. Packaged, electron-builder copies
 * `resources/bibles` to `<resourcesPath>/bibles` (extraResources, outside app.asar). In
 * development — and in tests — it's the repo's own `resources/bibles`; this file sits at
 * the same depth under src/ and dist/ (rootDir "src"), so `../../..` is the repo root from
 * either.
 */
export function bundledBiblesDir(opts: { packaged: boolean; resourcesPath?: string }): string {
  if (opts.packaged) {
    if (!opts.resourcesPath) throw new Error('bundledBiblesDir: resourcesPath is required when packaged');
    return path.join(opts.resourcesPath, 'bibles');
  }
  return path.join(__dirname, '..', '..', '..', 'resources', 'bibles');
}

export const seededSettingKey = (code: string) => `bundled.${code.toUpperCase()}.seeded`;

export interface SeedOptions {
  dir: string;
  /** Re-seed even if already seeded or a translation with that code exists (Restore bundled). */
  force?: boolean;
  /** Only this bundled translation (case-insensitive). */
  code?: string;
}

/** Codes of the bundled translations available in `dir` — one `<code>.json` per translation. */
export function listBundledCodes(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => path.basename(f, path.extname(f)).toUpperCase())
    .sort();
}

/**
 * Seeds each bundled translation once (D12). The `bundled.<code>.seeded` flag means a
 * translation the operator deliberately deleted doesn't come back on the next launch;
 * an existing translation with the same code (an OpenLP-imported KJV, say) is never
 * overwritten. `force` — *Restore bundled KJV* — bypasses both.
 *
 * The code comes from the file name, so an already-seeded launch never has to parse the
 * multi-megabyte JSON at all.
 */
export function seedBundledBibles(db: Database.Database, opts: SeedOptions): ImportResult[] {
  const results: ImportResult[] = [];
  for (const code of listBundledCodes(opts.dir)) {
    if (opts.code && code.toLowerCase() !== opts.code.toLowerCase()) continue;
    const flag = seededSettingKey(code);
    if (!opts.force) {
      if (getSetting(db, flag)) continue;
      const exists = db.prepare(`SELECT 1 FROM bible_translations WHERE code = ?`).get(code);
      if (exists) {
        // Something else already supplied this code; leave it alone, and don't revisit
        // the question on every launch (or after the operator deletes it).
        setSetting(db, flag, new Date().toISOString());
        continue;
      }
    }
    const file = path.join(opts.dir, `${code.toLowerCase()}.json`);
    const input = JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : findFile(opts.dir, code), 'utf8')) as
      TranslationInput;
    if (typeof input.code !== 'string' || input.code.toUpperCase() !== code) {
      throw new Error(`bundled Bible ${path.basename(file)} declares code ${JSON.stringify(input.code)}, expected ${code}`);
    }
    const result = upsertTranslation(db, { ...input, source: 'bundled' });
    setSetting(db, flag, new Date().toISOString());
    results.push({ ...result, file: path.basename(file) });
  }
  return results;
}

function findFile(dir: string, code: string): string {
  const match = fs.readdirSync(dir).find((f) => path.basename(f, path.extname(f)).toUpperCase() === code);
  if (!match) throw new Error(`no bundled Bible file for ${code}`);
  return path.join(dir, match);
}
