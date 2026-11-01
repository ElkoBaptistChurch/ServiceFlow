import path from 'path';
import Database from 'better-sqlite3';
import { ImportError, ImportResult, TranslationInput, VerseTuple } from '../../../shared/types';
import { upsertTranslation } from '../../db/bibleRepository';
import { mapOpenlpBook, OpenlpBookRow } from './bookMap';

// Metadata names OpenLP Bible downloads commonly carry, mapped to the code ServiceFlow
// uses. Importing OpenLP's KJV therefore lands on the same code as the bundled KJV and
// updates it in place (plan open question 3).
const KNOWN_TRANSLATION_NAMES: Record<string, string> = {
  'kjv': 'KJV',
  'king james version': 'KJV',
  'king james bible': 'KJV',
  'authorized version': 'KJV',
  'authorised version': 'KJV',
  'nkjv': 'NKJV',
  'new king james version': 'NKJV',
  'net': 'NET',
  'new english translation': 'NET',
  'net bible': 'NET',
};

// A trailing "(NET)"-style abbreviation, as in "New English Translation (NET)".
const TRAILING_CODE = /\(([A-Za-z0-9-]{2,10})\)\s*$/;
// A metadata name that is already a code: one short token, e.g. "ESV".
const BARE_CODE = /^[A-Za-z0-9-]{2,10}$/;

function codeFromLabel(label: string): string | undefined {
  const known = KNOWN_TRANSLATION_NAMES[label.trim().toLowerCase()];
  if (known) return known;
  const trailing = TRAILING_CODE.exec(label);
  if (trailing) return KNOWN_TRANSLATION_NAMES[trailing[1].toLowerCase()] ?? trailing[1].toUpperCase();
  const withoutTrailing = label.replace(TRAILING_CODE, '').trim();
  const knownWithout = KNOWN_TRANSLATION_NAMES[withoutTrailing.toLowerCase()];
  if (knownWithout) return knownWithout;
  if (BARE_CODE.test(label.trim())) return label.trim().toUpperCase();
  return undefined;
}

// I-09b: tracks, per claims scope (one per main database), which full file path claimed a
// given fallback code — so two unrelated files that both lack a recognisable name and
// share a basename (e.g. two folders each containing "bible.sqlite") don't collapse into
// one translation.
export type FallbackClaims = Map<string, string>;
const claimsByDb = new WeakMap<Database.Database, FallbackClaims>();

export interface OpenlpBibleRead {
  input: TranslationInput;
  /** Rows this adapter dropped before the repository saw them (unmappable books, orphan verses). */
  skipped: number;
  errors: ImportError[];
}

/**
 * Reads an OpenLP Bible file into the neutral TranslationInput shape. Reads everything
 * before anything is written (D-06), so a structural failure here — a missing column,
 * say — throws with the main database untouched.
 */
export function readOpenlpBible(openlpBibleDbPath: string, claims: FallbackClaims = new Map()): OpenlpBibleRead {
  const source = new Database(openlpBibleDbPath, { readonly: true, fileMustExist: true });
  try {
    const metaRows = source.prepare(`SELECT key, value FROM metadata`).all() as { key: string; value: string | null }[];
    const meta = new Map(metaRows.map((r) => [r.key, r.value]));
    const metaName = typeof meta.get('name') === 'string' ? meta.get('name')!.trim() : '';
    const basename = path.basename(openlpBibleDbPath, path.extname(openlpBibleDbPath)).trim();

    let code = metaName !== '' ? codeFromLabel(metaName) : undefined;
    if (!code) {
      const fallback = codeFromLabel(basename) ?? basename.toUpperCase();
      const claimedBy = claims.get(fallback);
      if (claimedBy && claimedBy !== openlpBibleDbPath) {
        // Two different files fell back to the same code — merging them would silently
        // mix two different Bibles' verses (I-09b). Disambiguate with the parent folder,
        // the same detail the operator used to tell the files apart when picking them.
        code = `${fallback} (${path.basename(path.dirname(openlpBibleDbPath))})`;
      } else {
        code = fallback;
        claims.set(fallback, openlpBibleDbPath);
      }
    }
    // "New English Translation (NET)" displays as "NET — New English Translation".
    const strippedName = metaName.replace(TRAILING_CODE, '').trim();
    const name = strippedName !== '' ? strippedName : metaName !== '' ? metaName : code;
    const copyright = meta.get('copyright');

    const bookRows = source
      .prepare(`SELECT id, name, book_reference_id, testament_reference_id FROM book`)
      .all() as OpenlpBookRow[];
    const verseRows = source.prepare(`SELECT book_id, chapter, verse, text FROM verse`).all() as {
      book_id: number | null;
      chapter: unknown;
      verse: unknown;
      text: unknown;
    }[];

    const errors: ImportError[] = [];
    let skipped = 0;

    // Source book id -> the input book its verses go into. Built once here so a source
    // id can never escape this adapter.
    const books: TranslationInput['books'] = [];
    const bookBySourceId = new Map<number, TranslationInput['books'][number]>();
    const claimedCodes = new Map<string, string>();
    bookRows.forEach((row, index) => {
      const identifier = row.id != null ? `book ${row.id}${row.name ? ` (${row.name})` : ''}` : `book row ${index}`;
      if (row.id == null) {
        // Nothing to key this book's verses off of.
        skipped += 1;
        errors.push({ identifier, reason: 'book has a NULL id and cannot be linked to its verses' });
        return;
      }
      const mapping = mapOpenlpBook(row);
      if (!mapping.ok) {
        skipped += 1;
        errors.push({ identifier, reason: mapping.reason });
        return;
      }
      const earlier = claimedCodes.get(mapping.book.code);
      if (earlier) {
        // Two rows naming the same book would merge their verses under one heading.
        skipped += 1;
        errors.push({ identifier, reason: `both this and ${earlier} are ${mapping.book.name}; this one was skipped` });
        return;
      }
      claimedCodes.set(mapping.book.code, identifier);
      if (mapping.warning) errors.push({ identifier, reason: `note: ${mapping.warning}` });
      const inputBook = { bookCode: mapping.book.code, name: row.name, verses: [] as VerseTuple[] };
      books.push(inputBook);
      bookBySourceId.set(row.id, inputBook);
    });

    const orphans = new Map<string, number>();
    for (const v of verseRows) {
      const book = v.book_id != null ? bookBySourceId.get(v.book_id) : undefined;
      if (!book) {
        // Its book was skipped above (and reported there), or never existed.
        const key = String(v.book_id);
        orphans.set(key, (orphans.get(key) ?? 0) + 1);
        continue;
      }
      // Values pass through untouched; upsertTranslation validates them.
      book.verses.push([v.chapter, v.verse, v.text] as VerseTuple);
    }
    for (const [sourceId, count] of orphans) {
      skipped += count;
      errors.push({
        identifier: `${code} source book ${sourceId}`,
        reason: `${count} verse${count === 1 ? '' : 's'} skipped: unknown or skipped source book id ${sourceId}`,
      });
    }

    return {
      input: {
        code,
        name,
        source: 'openlp',
        licenseNote: typeof copyright === 'string' && copyright.trim() !== '' ? copyright.trim() : null,
        books,
      },
      skipped,
      errors,
    };
  } finally {
    source.close();
  }
}

export function importOpenlpBible(mainDb: Database.Database, openlpBibleDbPath: string): ImportResult {
  let claims = claimsByDb.get(mainDb);
  if (!claims) {
    claims = new Map();
    claimsByDb.set(mainDb, claims);
  }
  const read = readOpenlpBible(openlpBibleDbPath, claims);
  const result = upsertTranslation(mainDb, read.input);
  return {
    ...result,
    file: path.basename(openlpBibleDbPath),
    skipped: result.skipped + read.skipped,
    errors: [...read.errors, ...result.errors],
  };
}
