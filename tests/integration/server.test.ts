import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { applySchema } from '../../src/main/db/schema';
import { seedDefaultOutputStyles } from '../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../src/main/db/stagedItemsRepository';
import { setLiveState, setOutputHidden } from '../../src/main/db/liveStateRepository';
import { createServer, ServerHandle } from '../../src/main/server/server';

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
});
