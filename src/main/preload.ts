import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipcChannels';
import type { ContentType, LiveState, StagedItemType, Theme } from '../shared/types';

// The theme the main process read out of the database before this window was created.
// Synchronous on purpose: an IPC round-trip resolves after the first paint, which is
// exactly the light flash this is here to prevent.
const THEME_ARG = '--serviceflow-theme=';
const initialTheme: Theme =
  process.argv.find((a) => a.startsWith(THEME_ARG))?.slice(THEME_ARG.length) === 'dark' ? 'dark' : 'light';

contextBridge.exposeInMainWorld('api', {
  initialTheme,
  listTranslations: () => ipcRenderer.invoke(IpcChannels.ListTranslations),
  getActiveTranslation: () => ipcRenderer.invoke(IpcChannels.GetActiveTranslation),
  setActiveTranslation: (translation: string) =>
    ipcRenderer.invoke(IpcChannels.SetActiveTranslation, translation),
  getTheme: () => ipcRenderer.invoke(IpcChannels.GetTheme),
  setTheme: (theme: Theme) => ipcRenderer.invoke(IpcChannels.SetTheme, theme),
  findBibleBooks: (query: string, translation: string) =>
    ipcRenderer.invoke(IpcChannels.FindBibleBooks, query, translation),
  getChaptersForBook: (bookId: number) => ipcRenderer.invoke(IpcChannels.GetChaptersForBook, bookId),
  getVersesForChapter: (bookId: number, chapter: number) =>
    ipcRenderer.invoke(IpcChannels.GetVersesForChapter, bookId, chapter),
  searchBibleContent: (query: string, translation: string) =>
    ipcRenderer.invoke(IpcChannels.SearchBibleContent, query, translation),
  findSongsByTitle: (query: string) => ipcRenderer.invoke(IpcChannels.FindSongsByTitle, query),
  getBlocksForSong: (songId: number) => ipcRenderer.invoke(IpcChannels.GetBlocksForSong, songId),
  searchSongContent: (query: string) => ipcRenderer.invoke(IpcChannels.SearchSongContent, query),
  createSong: (title: string, ccliNumber: string | null) =>
    ipcRenderer.invoke(IpcChannels.CreateSong, title, ccliNumber),
  updateSong: (id: number, title: string, ccliNumber: string | null) =>
    ipcRenderer.invoke(IpcChannels.UpdateSong, id, title, ccliNumber),
  deleteSong: (id: number) => ipcRenderer.invoke(IpcChannels.DeleteSong, id),
  addSongBlock: (songId: number, label: string, text: string) =>
    ipcRenderer.invoke(IpcChannels.AddSongBlock, songId, label, text),
  updateSongBlock: (id: number, label: string, text: string) =>
    ipcRenderer.invoke(IpcChannels.UpdateSongBlock, id, label, text),
  deleteSongBlock: (id: number) => ipcRenderer.invoke(IpcChannels.DeleteSongBlock, id),
  reorderSongBlocks: (songId: number, orderedIds: number[]) =>
    ipcRenderer.invoke(IpcChannels.ReorderSongBlocks, songId, orderedIds),
  getStagedItems: () => ipcRenderer.invoke(IpcChannels.GetStagedItems),
  stageItem: (type: StagedItemType, refId: number, chapter: number | null) =>
    ipcRenderer.invoke(IpcChannels.StageItem, type, refId, chapter),
  unstageItem: (id: number) => ipcRenderer.invoke(IpcChannels.UnstageItem, id),
  reorderStagedItems: (orderedIds: number[]) => ipcRenderer.invoke(IpcChannels.ReorderStagedItems, orderedIds),
  getLiveState: () => ipcRenderer.invoke(IpcChannels.GetLiveState),
  setLiveState: (stagedItemId: number | null, verseOrBlockId: number | null, styleId: number | null) =>
    ipcRenderer.invoke(IpcChannels.SetLiveState, stagedItemId, verseOrBlockId, styleId),
  setOutputHidden: (hidden: boolean) => ipcRenderer.invoke(IpcChannels.SetOutputHidden, hidden),
  getOutputStyles: (contentType: ContentType) => ipcRenderer.invoke(IpcChannels.GetOutputStyles, contentType),
  setActiveStyle: (contentType: ContentType, styleId: number) =>
    ipcRenderer.invoke(IpcChannels.SetActiveStyle, contentType, styleId),
  getServerUrls: () => ipcRenderer.invoke(IpcChannels.GetServerUrls),
  pickOpenlpFiles: () => ipcRenderer.invoke(IpcChannels.PickOpenlpFiles),
  importOpenlp: (filePaths: string[]) => ipcRenderer.invoke(IpcChannels.ImportOpenlp, filePaths),
  onLiveStateChanged: (callback: (state: LiveState) => void) => {
    const listener = (_event: unknown, state: LiveState) => callback(state);
    ipcRenderer.on(IpcChannels.LiveStateChanged, listener);
    return () => ipcRenderer.removeListener(IpcChannels.LiveStateChanged, listener);
  },
});
