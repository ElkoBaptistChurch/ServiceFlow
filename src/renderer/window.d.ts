import type { BibleBook, BibleSearchResult, BibleTranslation, ContentType, ImportResult, LiveState, OutputStyle, Song, SongBlock, SongSearchResult, StagedItem, StagedItemType, ImportSummary, BibleVerse, Theme } from '../shared/types';

export interface ServiceFlowApi {
  listTranslations(): Promise<BibleTranslation[]>;
  /** The active translation's code, e.g. 'KJV'. Null when no Bible is installed. */
  getActiveTranslation(): Promise<string | null>;
  setActiveTranslation(code: string): Promise<void>;
  /** Deletes a translation and unstages anything from it; returns the active translation afterwards. */
  deleteTranslation(code: string): Promise<{ activeTranslation: string | null }>;
  restoreBundledBible(code: string): Promise<ImportResult>;
  /** Read before this window was created, so the document can be themed pre-paint. */
  initialTheme: Theme;
  getTheme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<void>;
  findBibleBooks(query: string, translationCode: string): Promise<BibleBook[]>;
  /** bookId is always BibleBook.id — never an OpenLP source book id. */
  getChaptersForBook(bookId: number): Promise<number[]>;
  getVersesForChapter(bookId: number, chapter: number): Promise<BibleVerse[]>;
  searchBibleContent(query: string, translationCode: string): Promise<BibleSearchResult[]>;
  findSongsByTitle(query: string): Promise<Song[]>;
  findSongsByQuery(query: string): Promise<Song[]>;
  getBlocksForSong(songId: number): Promise<SongBlock[]>;
  searchSongContent(query: string): Promise<SongSearchResult[]>;
  findDuplicateSong(title: string, ccliNumber: string | null, excludeId: number): Promise<Song | null>;
  createSong(title: string, ccliNumber: string | null): Promise<Song>;
  updateSong(id: number, title: string, ccliNumber: string | null): Promise<void>;
  deleteSong(id: number): Promise<void>;
  addSongBlock(songId: number, label: string, text: string): Promise<SongBlock>;
  updateSongBlock(id: number, label: string, text: string): Promise<void>;
  deleteSongBlock(id: number): Promise<void>;
  reorderSongBlocks(songId: number, orderedIds: number[]): Promise<void>;
  getStagedItems(): Promise<StagedItem[]>;
  stageItem(type: StagedItemType, refId: number, chapter: number | null): Promise<StagedItem>;
  unstageItem(id: number): Promise<void>;
  reorderStagedItems(orderedIds: number[]): Promise<void>;
  getLiveState(): Promise<LiveState>;
  setLiveState(stagedItemId: number | null, verseOrBlockId: number | null, styleId: number | null): Promise<LiveState>;
  setOutputHidden(hidden: boolean): Promise<LiveState>;
  getOutputStyles(contentType: ContentType): Promise<OutputStyle[]>;
  setActiveStyle(contentType: ContentType, styleId: number): Promise<void>;
  getServerUrls(): Promise<{ local: string; lan: string | null }>;
  /** Opens a file dialog in OpenLP's own data folder. Bibles allow several files; songs one. */
  pickOpenlp(kind: 'bible' | 'songs'): Promise<string[]>;
  importOpenlpBibles(filePaths: string[]): Promise<ImportSummary>;
  importOpenlpSongs(filePath: string): Promise<ImportSummary>;
  onLiveStateChanged(callback: (state: LiveState) => void): () => void;
}

declare global {
  interface Window {
    api: ServiceFlowApi;
  }
}
