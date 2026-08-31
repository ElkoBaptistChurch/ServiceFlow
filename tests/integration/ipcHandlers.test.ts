import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../src/main/db/schema';
import { seedDefaultOutputStyles } from '../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../src/main/db/stagedItemsRepository';
import { createServer, ServerHandle } from '../../src/main/server/server';
import { getLiveState } from '../../src/main/db/liveStateRepository';
import {
  handleSetLiveState,
  handleSetOutputHidden,
  handleUnstageItem,
  handleImportOpenlp,
  getServerUrls,
} from '../../src/main/ipc/handlers';
import { IpcChannels } from '../../src/shared/ipcChannels';
import { createFixtureSongsDb, createFixtureBibleDb } from '../helpers/openlpFixtures';

let db: Database.Database;
let server: ServerHandle;

beforeEach(async () => {
  db = new Database(':memory:');
  applySchema(db);
  seedDefaultOutputStyles(db);
  server = createServer(db);
  await server.start(0);
});

describe('handleSetLiveState', () => {
  it('persists live state, broadcasts to the server, and pushes to the renderer window', () => {
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const stagedItem = addStagedItem(db, 'song', 1, null);

    const result = handleSetLiveState(db, server, fakeWindow, stagedItem.id, 5, null);

    expect(result.stagedItemId).toBe(stagedItem.id);
    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(IpcChannels.LiveStateChanged, result);
  });
});

describe('handleSetOutputHidden', () => {
  it('blanks the output and tells both the OBS page and the operator UI', () => {
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');
    const fakeWindow = { webContents: { send: vi.fn() } } as any;

    const result = handleSetOutputHidden(db, server, fakeWindow, true);

    expect(result.hidden).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(IpcChannels.LiveStateChanged, result);
  });
});

describe('handleUnstageItem', () => {
  // Without this, OBS keeps showing a verse the app has forgotten about.
  it('clears and broadcasts live state when the live item is removed', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const stagedItem = addStagedItem(db, 'song', 1, null);
    handleSetLiveState(db, server, fakeWindow, stagedItem.id, 5, null);
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');

    handleUnstageItem(db, server, fakeWindow, stagedItem.id);

    expect(getLiveState(db).stagedItemId).toBeNull();
    expect(broadcastSpy).toHaveBeenCalledOnce();
  });

  it('does not touch live state when a different item is removed', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const live = addStagedItem(db, 'song', 1, null);
    const other = addStagedItem(db, 'song', 2, null);
    handleSetLiveState(db, server, fakeWindow, live.id, 5, null);

    handleUnstageItem(db, server, fakeWindow, other.id);

    expect(getLiveState(db).stagedItemId).toBe(live.id);
  });
});

describe('handleImportOpenlp', () => {
  it('classifies each picked file by its schema and reports per-file results', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const songsPath = createFixtureSongsDb([
      {
        title: 'Test Song',
        lyrics:
          '<?xml version="1.0"?><song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Line one]]></verse></lyrics></song>',
      },
    ]);
    const biblePath = createFixtureBibleDb(
      'KJV',
      [{ id: 43, name: 'John', testamentReferenceId: 2 }],
      [{ bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world.' }]
    );

    const summary = handleImportOpenlp(db, server, fakeWindow, [songsPath, biblePath]);

    expect(summary.errors).toHaveLength(0);
    expect(summary.sources.map((s) => s.kind).sort()).toEqual(['bible', 'songs']);
    expect(summary.sources.find((s) => s.kind === 'songs')?.imported).toBe(1);
    expect(summary.sources.find((s) => s.kind === 'bible')?.translation).toBe('KJV');
  });

  it('does not misclassify a bible file just because its path mentions songs', () => {
    // The old filename heuristic broke on paths like C:\Users\songleader\bibles\KJV.sqlite.
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const biblePath = createFixtureBibleDb(
      'KJV',
      [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }],
      [{ bookId: 1, chapter: 1, verse: 1, text: 'In the beginning.' }]
    );
    const summary = handleImportOpenlp(db, server, fakeWindow, [biblePath]);
    expect(summary.sources[0].kind).toBe('bible');
  });

  // Carried-forward requirement from the Task 5 review: the song importer deletes and
  // reinserts a song's blocks with NEW rowids on every import, so a live_state row
  // captured before the import dangles afterwards. Re-import must clear live state
  // through the same funnel as every other live mutation (persist + broadcast), not by
  // writing live_state directly.
  it('clears live state and broadcasts through the funnel after an import while something was live', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const songsPath = createFixtureSongsDb([
      {
        title: 'Test Song',
        lyrics:
          '<?xml version="1.0"?><song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Line one]]></verse></lyrics></song>',
      },
    ]);
    // First import to get a real staged/live item pointing at a real block id.
    handleImportOpenlp(db, server, fakeWindow, [songsPath]);
    const stagedItem = addStagedItem(db, 'song', 1, null);
    const blocks = db.prepare(`SELECT id FROM song_blocks WHERE song_id = 1`).all() as { id: number }[];
    handleSetLiveState(db, server, fakeWindow, stagedItem.id, blocks[0].id, null);
    expect(getLiveState(db).stagedItemId).toBe(stagedItem.id);

    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');
    handleImportOpenlp(db, server, fakeWindow, [songsPath]);

    const cleared = getLiveState(db);
    expect(cleared.stagedItemId).toBeNull();
    expect(cleared.verseOrBlockId).toBeNull();
    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(IpcChannels.LiveStateChanged, cleared);
  });
});

describe('getServerUrls', () => {
  it('returns a localhost URL for the output page', () => {
    const urls = getServerUrls(4180);
    expect(urls.local).toBe('http://localhost:4180/output');
  });
});
