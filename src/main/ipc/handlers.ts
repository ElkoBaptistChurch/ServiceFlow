import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
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
import { importOpenlpSongs } from '../import/openlp/songs';
import { importOpenlpBible } from '../import/openlp/bible';
import { detectOpenlpFile, OpenlpFileKind } from '../import/openlp/detect';
import { seedBundledBibles } from '../content/bundledBibles';
import { ServerHandle } from '../server/server';
import { ContentType, Density, ImportResult, ImportSummary, LiveState, StagedItemType, Theme } from '../../shared/types';

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
 * Deleting a song must not leave OBS showing content the app no longer tracks: unstage
 * any staged item referencing it first (which itself clears live state through the same
 * funnel if it was live), then delete — the FK cascade takes care of its blocks.
 */
export function handleDeleteSong(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  songId: number
): void {
  const staged = db.prepare(`SELECT id FROM staged_items WHERE type = 'song' AND ref_id = ?`).all(songId) as {
    id: number;
  }[];
  for (const item of staged) handleUnstageItem(db, server, mainWindow, item.id);
  songRepo.deleteSong(db, songId);
}

/** Deleting the block currently live would otherwise leave live_state pointing at a rowid
 * that no longer exists — clear it through the same funnel as every other live mutation. */
export function handleDeleteSongBlock(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  blockId: number
): void {
  const wasLive = liveRepo.getLiveState(db).verseOrBlockId === blockId;
  songRepo.deleteBlock(db, blockId);
  if (wasLive) publishLiveState(server, mainWindow, liveRepo.clearLiveState(db));
}

/**
 * Deleting a translation must not leave OBS showing scripture the app no longer has:
 * every staged item that pointed at one of its books is unstaged (which clears live state
 * through the funnel if it was live). If it was the active translation, the setting moves
 * to the fallback (KJV if present, otherwise the first installed). Returns the active
 * translation afterwards so the renderer can follow.
 */
export function handleDeleteTranslation(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  code: string
): { activeTranslation: string | null } {
  const before = settingsRepo.getActiveTranslation(db, bibleRepo.listTranslationCodes(db));
  const { removedBookIds } = bibleRepo.deleteTranslation(db, code);
  if (removedBookIds.length > 0) {
    const staged = db
      .prepare(`SELECT id FROM staged_items WHERE type = 'bible' AND ref_id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(removedBookIds)) as { id: number }[];
    for (const item of staged) handleUnstageItem(db, server, mainWindow, item.id);
  }
  const activeTranslation = settingsRepo.getActiveTranslation(db, bibleRepo.listTranslationCodes(db));
  if (before != null && before.toLowerCase() === code.toLowerCase()) {
    if (activeTranslation) settingsRepo.setSetting(db, settingsRepo.SETTING_TRANSLATION, activeTranslation);
  }
  return { activeTranslation };
}

/** *Restore bundled KJV*: re-runs the bundled seed for one code, ignoring the seeded flag. */
export function handleRestoreBundled(db: Database.Database, biblesDir: string, code: string): ImportResult {
  const [result] = seedBundledBibles(db, { dir: biblesDir, force: true, code });
  if (!result) throw new Error(`ServiceFlow has no bundled Bible with the code ${code}`);
  return result;
}

export type OpenlpImportKind = 'bible' | 'songs';

/**
 * Where OpenLP keeps its data: `%APPDATA%\openlp\data\{bibles,songs}` on Windows. Used
 * as the file dialog's starting folder; undefined (the dialog's own default) if it
 * doesn't exist on this machine.
 */
export function openlpDataDir(appDataDir: string, kind: OpenlpImportKind): string | undefined {
  const dir = path.join(appDataDir, 'openlp', 'data', kind === 'bible' ? 'bibles' : 'songs');
  return fs.existsSync(dir) ? dir : undefined;
}

// A file with a malformed schema can produce far more error rows than the five the UI
// ever shows (I-05: 130k+ is reproducible and blows the call stack if spread into
// push). Cap what crosses IPC to a sane bound; `skipped` on each summary still carries
// the true total regardless of how many individual errors survive the cap.
const MAX_REPORTED_ERRORS_PER_SOURCE = 50;

// Import summaries cross into the renderer and may be read aloud or screenshotted; never
// let the operator's home directory (C:\Users\<name>) ride along in an error message.
function redactHome(message: string): string {
  const home = os.homedir();
  return home ? message.split(home).join('~') : message;
}

const WRONG_KIND_MESSAGE: Record<OpenlpImportKind, Partial<Record<OpenlpFileKind, string>>> = {
  bible: {
    songs: 'This looks like an OpenLP song database — use Library → Songs → Import from OpenLP…',
    unknown: 'not an OpenLP Bible database',
  },
  songs: {
    bible: 'This looks like an OpenLP Bible — use Library → Bibles → Import from OpenLP…',
    unknown: 'not an OpenLP song database',
  },
};

function failedSource(filePath: string, reason: string): ImportResult {
  const file = path.basename(filePath);
  return { file, kind: 'unknown', imported: 0, skipped: 0, errors: [{ identifier: file, reason: redactHome(reason) }] };
}

/**
 * One import entry point per content type, each placed next to the content it adds.
 * Every picked file is checked with detectOpenlpFile — by looking inside it, never by its
 * name — so a file of the wrong kind becomes a friendly per-file error while the rest of
 * the batch still imports.
 */
export function handleImportOpenlpFiles(
  db: Database.Database,
  server: ServerHandle,
  mainWindow: BrowserWindow,
  kind: OpenlpImportKind,
  filePaths: string[]
): ImportSummary {
  const combined: ImportSummary = { sources: [], imported: 0, skipped: 0, errors: [] };
  try {
    for (const filePath of filePaths) {
      let result: ImportResult;
      try {
        const detected = detectOpenlpFile(filePath);
        if (detected !== kind) {
          result = failedSource(filePath, WRONG_KIND_MESSAGE[kind][detected] ?? 'not an OpenLP database');
          result.skipped = 1;
        } else {
          result = kind === 'songs' ? importOpenlpSongs(db, filePath) : importOpenlpBible(db, filePath);
        }
      } catch (err) {
        // One file with an unexpected schema (e.g. an older OpenLP version) must not
        // abort files that haven't been attempted yet.
        result = failedSource(filePath, (err as Error).message);
      }

      const cappedErrors = result.errors
        .slice(0, MAX_REPORTED_ERRORS_PER_SOURCE)
        .map((e) => ({ identifier: redactHome(e.identifier), reason: redactHome(e.reason) }));
      combined.sources.push({ ...result, errors: cappedErrors });
      combined.imported += result.imported;
      combined.skipped += result.skipped;
      for (const error of cappedErrors) combined.errors.push(error);
    }
  } finally {
    // The song write path replaces a song's blocks with NEW rowids on every import, so a
    // live_state.verse_or_block_id captured before a song import can dangle afterwards.
    // If a song was live, clear live state through the funnel (persist + OBS + renderer).
    // Must run even if something above throws unexpectedly. Bible imports upsert verses
    // in place, so their ids — and a live verse — stay valid.
    if (kind === 'songs') {
      const live = liveRepo.getLiveState(db);
      const liveItem =
        live.stagedItemId !== null
          ? (db.prepare(`SELECT type FROM staged_items WHERE id = ?`).get(live.stagedItemId) as
              | { type: StagedItemType }
              | undefined)
          : undefined;
      if (liveItem?.type === 'song') publishLiveState(server, mainWindow, liveRepo.clearLiveState(db));
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
  port: number,
  biblesDir: string
): void {
  ipcMain.handle(IpcChannels.ListTranslations, () => bibleRepo.listTranslations(db));
  ipcMain.handle(IpcChannels.GetActiveTranslation, () =>
    settingsRepo.getActiveTranslation(db, bibleRepo.listTranslationCodes(db))
  );
  ipcMain.handle(IpcChannels.SetActiveTranslation, (_e, code: string) =>
    settingsRepo.setSetting(db, settingsRepo.SETTING_TRANSLATION, code)
  );
  ipcMain.handle(IpcChannels.DeleteTranslation, (_e, code: string) =>
    handleDeleteTranslation(db, server, mainWindow, code)
  );
  ipcMain.handle(IpcChannels.RestoreBundledBible, (_e, code: string) => handleRestoreBundled(db, biblesDir, code));
  ipcMain.handle(IpcChannels.GetTheme, () => settingsRepo.getTheme(db));
  ipcMain.handle(IpcChannels.SetTheme, (_e, theme: Theme) =>
    settingsRepo.setSetting(db, settingsRepo.SETTING_THEME, theme)
  );
  ipcMain.handle(IpcChannels.GetDensity, () => settingsRepo.getDensity(db));
  ipcMain.handle(IpcChannels.SetDensity, (_e, density: Density) =>
    settingsRepo.setSetting(db, settingsRepo.SETTING_DENSITY, density)
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
  ipcMain.handle(IpcChannels.FindSongsByQuery, (_e, query: string) => songRepo.findSongsByQuery(db, query));
  ipcMain.handle(IpcChannels.GetBlocksForSong, (_e, songId: number) => songRepo.getBlocksForSong(db, songId));
  ipcMain.handle(IpcChannels.SearchSongContent, (_e, query: string) => songRepo.searchSongContent(db, query));
  ipcMain.handle(IpcChannels.FindDuplicateSong, (_e, title: string, ccliNumber: string | null, excludeId: number) =>
    songRepo.findDuplicateSong(db, title, ccliNumber, excludeId)
  );
  ipcMain.handle(IpcChannels.CreateSong, (_e, title: string, ccliNumber: string | null) =>
    songRepo.createSong(db, title, ccliNumber)
  );
  ipcMain.handle(IpcChannels.UpdateSong, (_e, id: number, title: string, ccliNumber: string | null) =>
    songRepo.updateSong(db, id, title, ccliNumber)
  );
  ipcMain.handle(IpcChannels.DeleteSong, (_e, id: number) => handleDeleteSong(db, server, mainWindow, id));
  ipcMain.handle(IpcChannels.AddSongBlock, (_e, songId: number, label: string, text: string) =>
    songRepo.addBlock(db, songId, label, text)
  );
  ipcMain.handle(IpcChannels.UpdateSongBlock, (_e, id: number, label: string, text: string) =>
    songRepo.updateBlock(db, id, label, text)
  );
  ipcMain.handle(IpcChannels.DeleteSongBlock, (_e, id: number) => handleDeleteSongBlock(db, server, mainWindow, id));
  ipcMain.handle(IpcChannels.ReorderSongBlocks, (_e, songId: number, orderedIds: number[]) =>
    songRepo.reorderBlocks(db, songId, orderedIds)
  );
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
  ipcMain.handle(IpcChannels.PickOpenlp, async (_e, kind: OpenlpImportKind) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'bible' ? 'Import Bibles from OpenLP' : 'Import songs from OpenLP',
      defaultPath: openlpDataDir(app.getPath('appData'), kind),
      properties: kind === 'bible' ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'OpenLP database', extensions: ['sqlite'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IpcChannels.ImportOpenlpBibles, (_e, filePaths: string[]) =>
    handleImportOpenlpFiles(db, server, mainWindow, 'bible', filePaths)
  );
  ipcMain.handle(IpcChannels.ImportOpenlpSongs, (_e, filePath: string) =>
    handleImportOpenlpFiles(db, server, mainWindow, 'songs', [filePath])
  );
}
