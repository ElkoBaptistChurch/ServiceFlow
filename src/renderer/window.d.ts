import type { BibleBook, BibleSearchResult, ContentType, LiveState, OutputStyle, Song, SongBlock, SongSearchResult, StagedItem, StagedItemType, ImportSummary, BibleVerse } from '../shared/types';

export interface ServiceFlowApi {
  listTranslations(): Promise<string[]>;
  getActiveTranslation(): Promise<string | null>;
  setActiveTranslation(translation: string): Promise<void>;
  findBibleBooks(query: string, translation: string): Promise<BibleBook[]>;
  /** bookId is always BibleBook.id — never an OpenLP source book id. */
  getChaptersForBook(bookId: number): Promise<number[]>;
  getVersesForChapter(bookId: number, chapter: number): Promise<BibleVerse[]>;
  searchBibleContent(query: string, translation: string): Promise<BibleSearchResult[]>;
  findSongsByTitle(query: string): Promise<Song[]>;
  getBlocksForSong(songId: number): Promise<SongBlock[]>;
  searchSongContent(query: string): Promise<SongSearchResult[]>;
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
  pickOpenlpFiles(): Promise<string[]>;
  importOpenlp(filePaths: string[]): Promise<ImportSummary>;
  onLiveStateChanged(callback: (state: LiveState) => void): () => void;
}

declare global {
  interface Window {
    api: ServiceFlowApi;
  }
}
