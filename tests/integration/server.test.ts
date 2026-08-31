import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import net from 'net';
import WebSocket from 'ws';
import { applySchema } from '../../src/main/db/schema';
import { getStyles, seedDefaultOutputStyles, setActiveStyle } from '../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../src/main/db/stagedItemsRepository';
import { setLiveState, setOutputHidden } from '../../src/main/db/liveStateRepository';
import { createServer, buildOutputPayload, ServerHandle } from '../../src/main/server/server';

let db: Database.Database;
let server: ServerHandle;
let port: number;

function waitForMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('open', () => resolve()));
}

beforeEach(async () => {
  db = new Database(':memory:');
  applySchema(db);
  seedDefaultOutputStyles(db);
  db.prepare(
    `INSERT INTO bible_books (id, translation, source_book_id, name, testament, sort_order) VALUES (43, 'KJV', 43, 'John', 'NT', 43)`
  ).run();
  db.prepare(
    `INSERT INTO bible_verses (id, book_id, chapter, verse, text) VALUES (1, 43, 3, 16, 'For God so loved the world.')`
  ).run();
  db.prepare(`INSERT INTO songs (id, title) VALUES (1, 'Amazing Grace')`).run();
  db.prepare(
    `INSERT INTO song_blocks (id, song_id, label, text, display_order) VALUES (1, 1, 'V1', 'Amazing grace, how sweet the sound', 0)`
  ).run();
  server = createServer(db);
  port = await server.start(0);
});

afterEach(async () => {
  await server.stop();
});

describe('embedded server', () => {
  it('serves the output page over HTTP', async () => {
    const res = await fetch(`http://localhost:${port}/output/`);
    expect(res.status).toBe(200);
  });

  it('returns the current (empty) live state from GET /api/state', async () => {
    const res = await fetch(`http://localhost:${port}/api/state`);
    const body = await res.json();
    expect(body.contentType).toBeNull();
  });

  it('sends the current live state to a client immediately on connect', async () => {
    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null);

    const socket = new WebSocket(`ws://localhost:${port}/ws`);
    // Register the message listener before awaiting the open promise: the server
    // sends the initial live_update synchronously inside its 'connection' handler,
    // which can fire in the same tick as the client's 'open' event. Awaiting open
    // first would let that message arrive (and be dropped) before we ever attach
    // a listener for it.
    const messagePromise = waitForMessage(socket);
    await waitForOpen(socket);
    const message = await messagePromise;

    expect(message.type).toBe('live_update');
    expect(message.payload.contentType).toBe('bible');
    expect(message.payload.reference).toBe('John 3:16');
    socket.close();
  });

  it('broadcasts a live update to connected clients', async () => {
    const socket = new WebSocket(`ws://localhost:${port}/ws`);
    const initialMessagePromise = waitForMessage(socket);
    await waitForOpen(socket);
    await initialMessagePromise; // initial state on connect

    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null);

    const nextMessagePromise = waitForMessage(socket);
    server.broadcastLiveUpdate();
    const message = await nextMessagePromise;

    expect(message.payload.text).toBe('For God so loved the world.');
    socket.close();
  });

  it('reports a blanked output while keeping the selection', async () => {
    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null);
    setOutputHidden(db, true);

    const socket = new WebSocket(`ws://localhost:${port}/ws`);
    const messagePromise = waitForMessage(socket);
    await waitForOpen(socket);
    const message = await messagePromise;

    expect(message.payload.hidden).toBe(true);
    expect(message.payload.reference).toBe('John 3:16');
    socket.close();
  });

  it('resolves templateKey from the active bible style when no styleId is pinned', () => {
    const bibleStyles = getStyles(db, 'bible');
    const activeStyle = bibleStyles[0];
    setActiveStyle(db, 'bible', activeStyle.id);

    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null); // production call shape: no explicit styleId

    const payload = buildOutputPayload(db);
    expect(payload.templateKey).toBe(activeStyle.templateKey);
  });

  it('resolves templateKey from the active song style when no styleId is pinned', () => {
    const songStyles = getStyles(db, 'song');
    const activeStyle = songStyles[0];
    setActiveStyle(db, 'song', activeStyle.id);

    const stagedItem = addStagedItem(db, 'song', 1, null);
    setLiveState(db, stagedItem.id, 1, null); // production call shape: no explicit styleId

    const payload = buildOutputPayload(db);
    expect(payload.templateKey).toBe(activeStyle.templateKey);
  });

  it('resolves templateKey from an explicitly pinned styleId', () => {
    const bibleStyles = getStyles(db, 'bible');
    const pinnedStyle = bibleStyles[1];

    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, pinnedStyle.id);

    const payload = buildOutputPayload(db);
    expect(payload.templateKey).toBe(pinnedStyle.templateKey);
  });

  it('keeps the correct templateKey on a blanked payload so restore does not lose styling', () => {
    const bibleStyles = getStyles(db, 'bible');
    const activeStyle = bibleStyles[0];
    setActiveStyle(db, 'bible', activeStyle.id);

    const stagedItem = addStagedItem(db, 'bible', 43, 3);
    setLiveState(db, stagedItem.id, 1, null);
    setOutputHidden(db, true);

    const payload = buildOutputPayload(db);
    expect(payload.hidden).toBe(true);
    expect(payload.templateKey).toBe(activeStyle.templateKey);
  });

  // Regression test for a crash where a busy port took down the whole process: the
  // WebSocketServer built on the httpServer re-emits the httpServer's EADDRINUSE as its
  // own unhandled 'error' event, which Node's EventEmitter throws synchronously if nobody
  // is listening -- before start()'s reject() ever gets a chance to run. If this test file
  // itself dies mid-run (rather than failing an assertion), that IS the bug reproducing.
  it('rejects start() on a busy port instead of crashing, then recovers on start(0)', async () => {
    // Occupy a real port with a plain net server so createServer's start() collides with it.
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '0.0.0.0', () => resolve()));
    const busyPort = (occupied.address() as net.AddressInfo).port;

    // A fresh server/handle, separate from the shared beforeEach one, so we can exercise a
    // failed start() followed by a successful one on the very same handle.
    const otherServer = createServer(db);

    await expect(otherServer.start(busyPort)).rejects.toThrow();

    // The failed start() must leave no half-open handles behind: a subsequent start(0) on
    // the same handle must succeed and bind a real, different port.
    const recoveredPort = await otherServer.start(0);
    expect(recoveredPort).toBeGreaterThan(0);
    expect(recoveredPort).not.toBe(busyPort);

    await otherServer.stop();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  });
});
