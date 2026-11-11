import { CANONICAL_BOOKS, CanonicalBook, matchBookByName } from '../../../shared/bibleBooks';

/** A row from an OpenLP Bible file's `book` table. */
export interface OpenlpBookRow {
  id: number | null;
  name: string | null;
  book_reference_id: number | null;
  testament_reference_id: number | null;
}

export type OpenlpBookMapping =
  | { ok: true; book: CanonicalBook; warning?: string }
  | { ok: false; reason: string };

// OpenLP's book_reference_id 1-66 follows the Protestant canon in order, which is
// exactly the first 66 entries of CANONICAL_BOOKS.
const PROTESTANT = CANONICAL_BOOKS.filter((b) => b.testament !== 'AP');

/**
 * Maps one OpenLP book row to its canonical USFM book. OpenLP's own ids never leave this
 * adapter (D12): `book.id` is only meaningful inside one file (KJV's 44 is Romans, NET's
 * 44 is Acts), and `book_reference_id` is not unique either (KJV gives both Ezra and
 * Esdras 15, D7).
 *
 * - Canonical books (reference id 1-66): use the reference id, cross-checked against
 *   the name. If they disagree, the name wins and a warning is reported. A name we
 *   don't recognise (e.g. a non-English Bible) doesn't count as disagreement.
 * - Apocryphal books (testament 3, or a reference id outside 1-66): by name only.
 * - No match: the book is skipped and reported. Never guess.
 */
export function mapOpenlpBook(row: OpenlpBookRow): OpenlpBookMapping {
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const byName = name !== '' ? matchBookByName(name) : undefined;
  const ref = row.book_reference_id;
  const canonicalRef =
    row.testament_reference_id !== 3 && Number.isInteger(ref) && (ref as number) >= 1 && (ref as number) <= 66;

  if (!canonicalRef) {
    if (byName) return { ok: true, book: byName };
    return {
      ok: false,
      reason:
        name === ''
          ? `book has no name and no canonical reference id (${JSON.stringify(ref)}), so it can't be identified`
          : `unrecognised book name "${name}" (reference id ${JSON.stringify(ref)})`,
    };
  }

  const byRef = PROTESTANT[(ref as number) - 1];
  if (!byName || byName.code === byRef.code) return { ok: true, book: byRef };
  return {
    ok: true,
    book: byName,
    warning: `OpenLP reference id ${ref} means ${byRef.name}, but the book is named "${name}" — imported as ${byName.name}`,
  };
}
