export type ContentType = 'bible' | 'song';
export type Theme = 'light' | 'dark';
/** How tightly the operator's content pane packs verses/blocks. Operator UI only — never the output. */
export type Density = 'compact' | 'spacious';
export type Testament = 'OT' | 'NT' | 'AP';
export type StagedItemType = ContentType;

export type BibleSource = 'bundled' | 'openlp' | 'file';

export interface BibleBook {
  /** ServiceFlow's own surrogate id. Unique across translations. */
  id: number;
  /** Code of the translation this book belongs to, e.g. 'KJV'. */
  translationCode: string;
  /** Canonical USFM code, e.g. 'JHN' (src/shared/bibleBooks.ts). */
  bookCode: string;
  /** Display name as this translation spells it. */
  name: string;
  testament: Testament;
  sortOrder: number;
}

export interface BibleTranslation {
  /** Short identifier the app uses everywhere, e.g. 'KJV'. Case-insensitive unique. */
  code: string;
  name: string;
  source: BibleSource;
  licenseNote: string | null;
  bookCount: number;
  verseCount: number;
}

/** A verse as [chapter, verse, text]. */
export type VerseTuple = [chapter: number, verse: number, text: string];

/**
 * The neutral shape every Bible source (bundled resource, OpenLP adapter, future
 * formats) translates itself into before calling bibleRepository.upsertTranslation.
 */
export interface TranslationInput {
  code: string;
  name: string;
  source: BibleSource;
  licenseNote?: string | null;
  books: { bookCode: string; name?: string | null; verses: VerseTuple[] }[];
}

export interface BibleVerse {
  id: number;
  /** References BibleBook.id, which already implies the translation. */
  bookId: number;
  chapter: number;
  verse: number;
  text: string;
}

export interface BibleSearchResult {
  verse: BibleVerse;
  bookName: string;
  translation: string;
}

export interface Song {
  id: number;
  title: string;
  ccliNumber: string | null;
}

export interface SongBlock {
  id: number;
  songId: number;
  label: string;
  text: string;
  displayOrder: number;
}

export interface SongSearchResult {
  block: SongBlock;
  songTitle: string;
}

export interface StagedItem {
  id: number;
  type: StagedItemType;
  refId: number;
  chapter: number | null;
  position: number;
  label: string;
}

export interface LiveState {
  stagedItemId: number | null;
  verseOrBlockId: number | null;
  styleId: number | null;
  /** True while the operator has blanked the output; the selection is preserved. */
  hidden: boolean;
  updatedAt: string;
  /** Human-readable current reference, e.g. 'John 3:16'. Null when nothing is live. */
  reference: string | null;
}

export interface OutputStyle {
  id: number;
  contentType: ContentType;
  name: string;
  templateKey: string;
  settings: Record<string, unknown>;
  isActive: boolean;
}

export interface OutputPayload {
  contentType: ContentType | null;
  text: string | null;
  reference: string | null;
  styleId: number | null;
  templateKey: string | null;
  /** True when the operator has blanked the output. The page renders nothing. */
  hidden: boolean;
}

export interface ImportError {
  identifier: string;
  reason: string;
}

/** One imported file (or other source). The operator needs per-source counts, not one merged number. */
export interface ImportResult {
  /** Basename of the file the operator picked, or the source's name. */
  file: string;
  kind: 'songs' | 'bible' | 'unknown';
  /** Translation code, for bible sources only. */
  translation?: string;
  imported: number;
  skipped: number;
  errors: ImportError[];
}

export interface ImportSummary {
  sources: ImportResult[];
  imported: number;
  skipped: number;
  errors: ImportError[];
}
