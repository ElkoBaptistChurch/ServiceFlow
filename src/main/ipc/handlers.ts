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
import { ContentType, ImportSourceSummary, ImportSummary, LiveState, StagedItemType } from '../../shared/types';

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

/**
 * `bible_verses` and `song_blocks` are independent AUTOINCREMENT sequences, so a
 * (stagedItemId, verseOrBlockId) pair from two unrelated items almost always resolves
 * to a real row on the wrong side -- there is no foreign key to catch it. This is the
 * load-bearing check for that invariant; the renderer (R-13) and schema (D-04) harden
 * their own layers too, but a bad pair must be refused here.
 */
function assertVerseBelongsToStagedItem(
  db: Database.Database,
  stagedItemId: number,
  verseOrBlockId: number
): void {
  const item = db.prepare(`SELECT type, ref_id, chapter FROM staged_items WHERE id = ?`).get(stagedItemId) as
    | { type: StagedItemType; ref_id: number; chapter: number | null }
    | undefined;
  if (!item) throw new Error(`setLiveState: staged item ${stagedItemId} does not exist`);

  if (item.type === 'bible') {
    const verse = db.prepare(`SELECT book_id, chapter FROM bible_verses WHERE id = ?`).get(verseOrBlockId) as
      | { book_id: number; chapter: number }
      | undefined;
    if (!verse || verse.book_id !== item.ref_id || verse.chapter !== item.chapter) {
      throw new Error(`setLiveState: verse ${verseOrBlockId} does not belong to staged item ${stagedItemId}`);
    }
  } else {
    const block = db.prepare(`SELECT song_id FROM song_blocks WHERE id = ?`).get(verseOrBlockId) as
      | { song_id: number }
      | undefined;
    if (!block || block.song_id !== item.ref_id) {
      throw new Error(`setLiveState: block ${verseOrBlockId} does not belong to staged item ${stagedItemId}`);
    }
  }
}

export function handleSetLiveState(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  stagedItemId: number | null,
  verseOrBlockId: number | null,
  styleId: number | null
): LiveState {
  if (stagedItemId !== null && verseOrBlockId !== null) {
    assertVerseBelongsToStagedItem(db, stagedItemId, verseOrBlockId);
  }
  return publishLiveState(server, mainWindow, liveRepo.setLiveState(db, stagedItemId, verseOrBlockId, styleId));
}

/** Routed through the same funnel as every other mutation so OBS updates immediately. */
export function handleSetActiveStyle(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  contentType: ContentType,
  styleId: number
): void {
  stylesRepo.setActiveStyle(db, contentType, styleId);
  publishLiveState(server, mainWindow, liveRepo.getLiveState(db));
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
// A file with a malformed schema can produce far more error rows than the five the UI
// ever shows (I-05: 130k+ is reproducible and blows the call stack if spread into
// push). Cap what crosses IPC to a sane bound; `skipped` on each summary still carries
// the true total regardless of how many individual errors survive the cap.
const MAX_REPORTED_ERRORS_PER_SOURCE = 50;

export function handleImportOpenlp(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  filePaths: string[]
): ImportSummary {
  const combined: ImportSummary = { sources: [], imported: 0, skipped: 0, errors: [] };
  try {
    for (const filePath of filePaths) {
      let result: ImportSourceSummary;
      try {
        const kind = detectOpenlpFile(filePath);
        if (kind === 'songs') {
          result = importOpenlpSongs(db, filePath);
        } else if (kind === 'bible') {
          result = importOpenlpBible(db, filePath);
        } else {
          result = {
            file: path.basename(filePath),
            kind: 'unknown',
            imported: 0,
            skipped: 1,
            errors: [{ identifier: path.basename(filePath), reason: 'not an OpenLP song or bible database' }],
          };
        }
      } catch (err) {
        // One file with an unexpected schema (e.g. an older OpenLP version) must not
        // abort files that haven't been attempted yet.
        result = {
          file: path.basename(filePath),
          kind: 'unknown',
          imported: 0,
          skipped: 0,
          errors: [{ identifier: path.basename(filePath), reason: (err as Error).message }],
        };
      }

      const cappedErrors =
        result.errors.length > MAX_REPORTED_ERRORS_PER_SOURCE
          ? result.errors.slice(0, MAX_REPORTED_ERRORS_PER_SOURCE)
          : result.errors;
      combined.sources.push({ ...result, errors: cappedErrors });
      combined.imported += result.imported;
      combined.skipped += result.skipped;
      for (const error of cappedErrors) combined.errors.push(error);
    }
  } finally {
    // Must run even if something above throws unexpectedly -- otherwise live_state can
    // dangle at a rowid the re-inserted blocks no longer use (see the doc comment above).
    if (liveRepo.getLiveState(db).stagedItemId !== null) {
      publishLiveState(server, mainWindow, liveRepo.clearLiveState(db));
    }
  }

  return combined;
}

// Matches the virtual/host-only adapters common on a media PC (Hyper-V, WSL, Docker
// Desktop, VMware, VirtualBox) whose addresses only exist inside the host and would
// otherwise be picked ahead of the real LAN adapter by enumeration order alone.
const VIRTUAL_ADAPTER_NAME = /^(vEthernet|Virtual|VMware|VirtualBox|Hyper-V|docker|veth|br-|Loopback|WSL)/i;

export function getServerUrls(port: number): { local: string; lan: string | null } {
  const local = `http://localhost:${port}/output`;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (VIRTUAL_ADAPTER_NAME.test(name)) continue;
    for (const iface of interfaces[name] ?? []) {
      // 169.254.*/16 is APIPA/link-local -- assigned when a NIC never reached a DHCP
      // server, never a usable LAN address.
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
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
    handleSetActiveStyle(db, server, mainWindow, contentType, styleId)
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
