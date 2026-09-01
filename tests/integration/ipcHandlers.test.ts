import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { applySchema } from '../../src/main/db/schema';
import { seedDefaultOutputStyles, getStyles } from '../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../src/main/db/stagedItemsRepository';
import { createServer, ServerHandle } from '../../src/main/server/server';
import { getLiveState } from '../../src/main/db/liveStateRepository';
import {
  handleSetLiveState,
  handleSetOutputHidden,
  handleSetActiveStyle,
  handleUnstageItem,
  handleImportOpenlp,
  getServerUrls,
} from '../../src/main/ipc/handlers';
import { IpcChannels } from '../../src/shared/ipcChannels';
import { createFixtureSongsDb, createFixtureBibleDb } from '../helpers/openlpFixtures';

const SONG_LYRICS_XML =
  '<?xml version="1.0"?><song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Line one]]></verse></lyrics></song>';

/** A bible source with no book rows, so every one of `count` verses fails to link. */
function createFixtureBibleDbWithManyErrors(count: number): string {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bible-huge-')), 'bible.sqlite');
  const src = new Database(dbPath);
  src.exec(`
    CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
    CREATE TABLE book (id INTEGER NOT NULL PRIMARY KEY, book_reference_id INTEGER, testament_reference_id INTEGER, name VARCHAR(50));
    CREATE TABLE verse (id INTEGER NOT NULL PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
  `);
  src.prepare(`INSERT INTO metadata (key, value) VALUES ('name', 'KJV')`).run();
  const insertVerse = src.prepare(`INSERT INTO verse (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
  const tx = src.transaction((n: number) => {
    for (let i = 0; i < n; i++) insertVerse.run(999, 1, i + 1, 'x');
  });
  tx(count);
  src.close();
  return dbPath;
}

/** Imports one fixture song and returns real ids -- setLiveState now rejects fabricated ones. */
function importSong(fakeWindow: any, title: string): { songId: number; blockId: number } {
  const songsPath = createFixtureSongsDb([{ title, lyrics: SONG_LYRICS_XML }]);
  handleImportOpenlp(db, server, fakeWindow, [songsPath]);
  const song = db.prepare(`SELECT id FROM songs WHERE title = ?`).get(title) as { id: number };
  const block = db.prepare(`SELECT id FROM song_blocks WHERE song_id = ?`).get(song.id) as { id: number };
  return { songId: song.id, blockId: block.id };
}

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
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const { songId, blockId } = importSong(fakeWindow, 'Test Song');
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');
    const stagedItem = addStagedItem(db, 'song', songId, null);

    const result = handleSetLiveState(db, server, fakeWindow, stagedItem.id, blockId, null);

    expect(result.stagedItemId).toBe(stagedItem.id);
    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(IpcChannels.LiveStateChanged, result);
  });

  // John 3:16 must never be able to go live labelled "Romans 8:1" — the three layers
  // this invariant crosses are described in the M-09 / D-04 / R-13 bug entries.
  it('rejects a live state whose verse does not belong to the staged item', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const biblePath = createFixtureBibleDb(
      'KJV',
      [
        { id: 43, name: 'John', testamentReferenceId: 2 },
        { id: 45, name: 'Romans', testamentReferenceId: 2 },
      ],
      [
        { bookId: 43, chapter: 3, verse: 16, text: 'For God so loved the world.' },
        { bookId: 45, chapter: 8, verse: 1, text: 'There is therefore now no condemnation.' },
      ]
    );
    handleImportOpenlp(db, server, fakeWindow, [biblePath]);
    const johnBook = db.prepare(`SELECT id FROM bible_books WHERE name = 'John'`).get() as { id: number };
    const romansVerse = db
      .prepare(`SELECT id FROM bible_verses WHERE text LIKE 'There is therefore%'`)
      .get() as { id: number };
    const stagedJohn3 = addStagedItem(db, 'bible', johnBook.id, 3);

    expect(() => handleSetLiveState(db, server, fakeWindow, stagedJohn3.id, romansVerse.id, null)).toThrow();
    expect(getLiveState(db).stagedItemId).toBeNull();
  });

  it('rejects a live state whose block belongs to a different song', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const songsPath = createFixtureSongsDb([
      { title: 'Song A', lyrics: SONG_LYRICS_XML },
      { title: 'Song B', lyrics: SONG_LYRICS_XML },
    ]);
    handleImportOpenlp(db, server, fakeWindow, [songsPath]);
    const songB = db.prepare(`SELECT id FROM songs WHERE title = 'Song B'`).get() as { id: number };
    const blockA = db
      .prepare(`SELECT sb.id FROM song_blocks sb JOIN songs s ON s.id = sb.song_id WHERE s.title = 'Song A'`)
      .get() as { id: number };
    const stagedSongB = addStagedItem(db, 'song', songB.id, null);

    expect(() => handleSetLiveState(db, server, fakeWindow, stagedSongB.id, blockA.id, null)).toThrow();
  });
});

describe('handleSetActiveStyle', () => {
  // The only mutation handler that used to skip publishLiveState — the operator UI would
  // flip to "(active)" while OBS kept rendering the old style until the next verse change.
  it('broadcasts to OBS when the active style changes', () => {
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const styles = getStyles(db, 'bible');
    const target = styles.find((s) => !s.isActive)!;

    handleSetActiveStyle(db, server, fakeWindow, 'bible', target.id);

    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(IpcChannels.LiveStateChanged, expect.anything());
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
    const { songId, blockId } = importSong(fakeWindow, 'Test Song');
    const stagedItem = addStagedItem(db, 'song', songId, null);
    handleSetLiveState(db, server, fakeWindow, stagedItem.id, blockId, null);
    const broadcastSpy = vi.spyOn(server, 'broadcastLiveUpdate');

    handleUnstageItem(db, server, fakeWindow, stagedItem.id);

    expect(getLiveState(db).stagedItemId).toBeNull();
    expect(broadcastSpy).toHaveBeenCalledOnce();
  });

  it('does not touch live state when a different item is removed', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const liveSong = importSong(fakeWindow, 'Live Song');
    const otherSong = importSong(fakeWindow, 'Other Song');
    const live = addStagedItem(db, 'song', liveSong.songId, null);
    const other = addStagedItem(db, 'song', otherSong.songId, null);
    handleSetLiveState(db, server, fakeWindow, live.id, liveSong.blockId, null);

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

  // Before this fix, file 2 throwing meant file 3 was never attempted and no summary
  // was shown at all -- just a raw SqliteError in the generic error banner.
  it('reports a failed file and still imports the others', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const goodPath = createFixtureSongsDb([{ title: 'Good Song', lyrics: SONG_LYRICS_XML }]);

    // An older-schema songs.sqlite: passes detectOpenlpFile's table-name-only check,
    // then throws from importOpenlpSongs' top-level SELECT (missing lyrics/ccli_number).
    const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-broken-'));
    const brokenPath = path.join(brokenDir, 'broken.sqlite');
    const brokenDb = new Database(brokenPath);
    brokenDb.exec(`CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT);`);
    brokenDb.close();

    const anotherGoodPath = createFixtureSongsDb([{ title: 'Another Good Song', lyrics: SONG_LYRICS_XML }]);

    const summary = handleImportOpenlp(db, server, fakeWindow, [goodPath, brokenPath, anotherGoodPath]);

    expect(summary.sources).toHaveLength(3);
    expect(summary.sources[0].imported).toBe(1);
    expect(summary.sources[1].imported).toBe(0);
    expect(summary.sources[1].errors[0]?.reason).toBeTruthy();
    expect(summary.sources[2].imported).toBe(1);
    expect(summary.imported).toBe(2);
  });

  it('reports an unrecognised file as unknown, not bible', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const junkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-junk-'));
    const junkPath = path.join(junkDir, 'photo.sqlite');
    fs.writeFileSync(junkPath, 'not a sqlite database');

    const summary = handleImportOpenlp(db, server, fakeWindow, [junkPath]);

    expect(summary.sources[0].kind).toBe('unknown');
  });

  it('handles an import that produces more than 130000 errors', () => {
    const fakeWindow = { webContents: { send: vi.fn() } } as any;
    const biblePath = createFixtureBibleDbWithManyErrors(130000);

    let summary: ReturnType<typeof handleImportOpenlp>;
    expect(() => {
      summary = handleImportOpenlp(db, server, fakeWindow, [biblePath]);
    }).not.toThrow();

    expect(summary!.skipped).toBe(130000);
    expect(summary!.errors.length).toBeLessThan(1000);
  });
});

describe('getServerUrls', () => {
  it('returns a localhost URL for the output page', () => {
    const urls = getServerUrls(4180);
    expect(urls.local).toBe('http://localhost:4180/output');
  });

  it('prefers a real LAN address over a virtual adapter', () => {
    const spy = vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      'vEthernet (Default Switch)': [
        {
          address: '172.28.112.1',
          netmask: '255.255.240.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '172.28.112.1/20',
        },
      ],
      Ethernet: [
        {
          address: '192.168.1.42',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '192.168.1.42/24',
        },
      ],
    } as any);

    const urls = getServerUrls(4180);

    expect(urls.lan).toBe('http://192.168.1.42:4180/output');
    spy.mockRestore();
  });
});
