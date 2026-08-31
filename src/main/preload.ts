import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipcChannels';
import type { ContentType, LiveState, StagedItemType } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  listTranslations: () => ipcRenderer.invoke(IpcChannels.ListTranslations),
  getActiveTranslation: () => ipcRenderer.invoke(IpcChannels.GetActiveTranslation),
  setActiveTranslation: (translation: string) =>
    ipcRenderer.invoke(IpcChannels.SetActiveTranslation, translation),
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
