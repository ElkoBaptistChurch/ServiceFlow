export type ContentType = 'bible' | 'song';
export type Testament = 'OT' | 'NT' | 'AP';
export type StagedItemType = ContentType;

export interface BibleBook {
  /** ServiceFlow's own surrogate id. Unique across translations. */
  id: number;
  /** Translation code from the source file's metadata, e.g. 'KJV'. */
  translation: string;
  /** The id this book had in its OpenLP source file. Only unique within a translation. */
  sourceBookId: number;
  name: string;
  testament: Testament;
  sortOrder: number;
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

/** One imported file. The operator needs per-file counts, not one merged number. */
export interface ImportSourceSummary {
  /** Basename of the file the operator picked. */
  file: string;
  kind: 'songs' | 'bible';
  /** Translation code, for bible sources only. */
  translation?: string;
  imported: number;
  skipped: number;
  errors: ImportError[];
}

export interface ImportSummary {
  sources: ImportSourceSummary[];
  imported: number;
  skipped: number;
  errors: ImportError[];
}
