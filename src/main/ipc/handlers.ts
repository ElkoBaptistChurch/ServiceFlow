import { ipcMain, dialog, BrowserWindow } from 'electron';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { IpcChannels } from '../../shared/ipcChannels';
import * as bibleRepo from '../db/bibleRepository';
import * as songRepo from '../db/songRepository';
import * as stagedRepo from '../db/stagedItemsRepository';
import * as liveRepo from '../db/liveStateRepository';
import * as stylesRepo from '../db/outputStylesRepository';
import * as settingsRepo from '../db/settingsRepository';
import { importOpenlpSongs } from '../import/openlpSongsImporter';
import { importOpenlpBible } from '../import/openlpBibleImporter';
import { detectOpenlpFile } from '../import/detectOpenlpFile';
import { ServerHandle } from '../server/server';
import { ContentType, ImportSourceSummary, ImportSummary, LiveState, StagedItemType, Theme } from '../../shared/types';

/** Single funnel for every live-state change: persist, push to OBS, push to the UI. */
function publishLiveState(
  server: ServerHandle,
  mainWindow: BrowserWindow,
  state: LiveState
): LiveState {
  server.broadcastLiveUpdate();
  mainWindow.webContents.send(IpcChannels.LiveStateChanged, state);
  return state;
}

export function handleSetLiveState(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  stagedItemId: number | null,
  verseOrBlockId: number | null,
  styleId: number | null
): LiveState {
  return publishLiveState(server, mainWindow, liveRepo.setLiveState(db, stagedItemId, verseOrBlockId, styleId));
}

export function handleSetOutputHidden(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  hidden: boolean
): LiveState {
  return publishLiveState(server, mainWindow, liveRepo.setOutputHidden(db, hidden));
}

/**
 * Removing the staged item that is currently live must also clear live state and
 * broadcast it — otherwise OBS keeps displaying content the app no longer tracks,
 * and only blanks the next time the Browser Source happens to reconnect.
 */
export function handleUnstageItem(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  stagedItemId: number
): void {
  const wasLive = liveRepo.getLiveState(db).stagedItemId === stagedItemId;
  stagedRepo.removeStagedItem(db, stagedItemId);
  if (wasLive) publishLiveState(server, mainWindow, liveRepo.clearLiveState(db));
}

/**
 * Files are classified by looking inside them, never by filename — a bible file under
 * `C:\Users\songleader\...` would otherwise be imported as a song library.
 *
 * The song importer deletes and reinserts a song's blocks with NEW rowids on every
 * import (see openlpSongsImporter), so a live_state.verse_or_block_id captured before
 * an import can dangle afterwards — pointing at a row the database no longer has. If
 * anything was live when the import ran, clear live state through the same funnel as
 * every other live mutation (persist + broadcast to OBS + notify the renderer), rather
 * than leaving OBS showing content the app no longer tracks.
 */
export function handleImportOpenlp(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  filePaths: string[]
): ImportSummary {
  const combined: ImportSummary = { sources: [], imported: 0, skipped: 0, errors: [] };
  for (const filePath of filePaths) {
    const kind = detectOpenlpFile(filePath);
    let result: ImportSourceSummary;
    if (kind === 'songs') {
      result = importOpenlpSongs(db, filePath);
    } else if (kind === 'bible') {
      result = importOpenlpBible(db, filePath);
    } else {
      result = {
        file: path.basename(filePath),
        kind: 'bible',
        imported: 0,
        skipped: 1,
        errors: [{ identifier: path.basename(filePath), reason: 'not an OpenLP song or bible database' }],
      };
    }
    combined.sources.push(result);
    combined.imported += result.imported;
    combined.skipped += result.skipped;
    combined.errors.push(...result.errors);
  }

  if (liveRepo.getLiveState(db).stagedItemId !== null) {
    publishLiveState(server, mainWindow, liveRepo.clearLiveState(db));
  }

  return combined;
}

export function getServerUrls(port: number): { local: string; lan: string | null } {
  const local = `http://localhost:${port}/output`;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return { local, lan: `http://${iface.address}:${port}/output` };
      }
    }
  }
  return { local, lan: null };
}

export function registerIpcHandlers(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  port: number
): void {
  ipcMain.handle(IpcChannels.ListTranslations, () => bibleRepo.listTranslations(db));
  ipcMain.handle(IpcChannels.GetActiveTranslation, () =>
    settingsRepo.getActiveTranslation(db, bibleRepo.listTranslations(db))
  );
  ipcMain.handle(IpcChannels.SetActiveTranslation, (_e, translation: string) =>
    settingsRepo.setSetting(db, settingsRepo.SETTING_TRANSLATION, translation)
  );
  ipcMain.handle(IpcChannels.GetTheme, () => settingsRepo.getTheme(db));
  ipcMain.handle(IpcChannels.SetTheme, (_e, theme: Theme) =>
    settingsRepo.setSetting(db, settingsRepo.SETTING_THEME, theme)
  );
  ipcMain.handle(IpcChannels.FindBibleBooks, (_e, query: string, translation: string) =>
    bibleRepo.findBooksByName(db, query, translation)
  );
  // bookId here is always bible_books.id, which already carries its translation.
  ipcMain.handle(IpcChannels.GetChaptersForBook, (_e, bookId: number) => bibleRepo.getChaptersForBook(db, bookId));
  ipcMain.handle(IpcChannels.GetVersesForChapter, (_e, bookId: number, chapter: number) =>
    bibleRepo.getVersesForChapter(db, bookId, chapter)
  );
  ipcMain.handle(IpcChannels.SearchBibleContent, (_e, query: string, translation: string) =>
    bibleRepo.searchBibleContent(db, query, translation)
  );
  ipcMain.handle(IpcChannels.FindSongsByTitle, (_e, query: string) => songRepo.findSongsByTitle(db, query));
  ipcMain.handle(IpcChannels.GetBlocksForSong, (_e, songId: number) => songRepo.getBlocksForSong(db, songId));
  ipcMain.handle(IpcChannels.SearchSongContent, (_e, query: string) => songRepo.searchSongContent(db, query));
  ipcMain.handle(IpcChannels.GetStagedItems, () => stagedRepo.getStagedItems(db));
  ipcMain.handle(IpcChannels.StageItem, (_e, type: StagedItemType, refId: number, chapter: number | null) =>
    stagedRepo.addStagedItem(db, type, refId, chapter)
  );
  ipcMain.handle(IpcChannels.UnstageItem, (_e, id: number) => handleUnstageItem(db, server, mainWindow, id));
  ipcMain.handle(IpcChannels.ReorderStagedItems, (_e, orderedIds: number[]) => stagedRepo.reorderStagedItems(db, orderedIds));
  ipcMain.handle(IpcChannels.GetLiveState, () => liveRepo.getLiveState(db));
  ipcMain.handle(
    IpcChannels.SetLiveState,
    (_e, stagedItemId: number | null, verseOrBlockId: number | null, styleId: number | null) =>
      handleSetLiveState(db, server, mainWindow, stagedItemId, verseOrBlockId, styleId)
  );
  ipcMain.handle(IpcChannels.SetOutputHidden, (_e, hidden: boolean) =>
    handleSetOutputHidden(db, server, mainWindow, hidden)
  );
  ipcMain.handle(IpcChannels.GetOutputStyles, (_e, contentType: ContentType) => stylesRepo.getStyles(db, contentType));
  ipcMain.handle(IpcChannels.SetActiveStyle, (_e, contentType: ContentType, styleId: number) =>
    stylesRepo.setActiveStyle(db, contentType, styleId)
  );
  ipcMain.handle(IpcChannels.GetServerUrls, () => getServerUrls(port));
  ipcMain.handle(IpcChannels.PickOpenlpFiles, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IpcChannels.ImportOpenlp, (_e, filePaths: string[]) =>
    handleImportOpenlp(db, server, mainWindow, filePaths)
  );
}
