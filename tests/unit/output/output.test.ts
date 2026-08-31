import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket as NodeWebSocket } from 'ws';
import { applySchema } from '../../../src/main/db/schema';
import { seedDefaultOutputStyles } from '../../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../../src/main/db/stagedItemsRepository';
import { setLiveState } from '../../../src/main/db/liveStateRepository';
import { createServer, ServerHandle } from '../../../src/main/server/server';

let db: Database.Database;
let server: ServerHandle;
let port: number;

// A harmless stand-in installed once the test is done asserting. output.js schedules a
// reconnect (`setTimeout(connect, 1000)`) on every socket close, including the one we
// trigger ourselves for teardown; swapping the global to this inert class before closing
// means that eventual reconnect attempt constructs something with no real connection and
// no further events, instead of either leaking a real socket or throwing when the test's
// own server is already stopped.
class NoopWebSocket {
  addEventListener() {}
  removeEventListener() {}
  close() {}
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
  const stagedItem = addStagedItem(db, 'bible', 43, 3);
  setLiveState(db, stagedItem.id, 1, null);

  server = createServer(db);
  port = await server.start(0);

  document.body.innerHTML = '<div id="output-root" class="output-root hidden"></div>';
});

afterEach(async () => {
  await server.stop();
  document.body.innerHTML = '';
  delete (globalThis as any).fetch;
  delete (globalThis as any).WebSocket;
  vi.resetModules();
});

describe('output.js (M1: no load-time fetch, self-heal via WebSocket push only)', () => {
  it('renders the state the server pushes on connect, and never calls fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('output.js must not fetch on load')));
    (globalThis as any).fetch = fetchSpy;

    // output.js builds its WebSocket URL from `location.host`. jsdom's fixed test origin
    // can't be made to match the real, dynamically-assigned port our server bound to (and
    // jsdom's `location` cannot be reconfigured after creation). Rewrite the host at the
    // WebSocket constructor boundary instead of touching output.js's own logic, so the
    // real client<->server push path is still exercised end-to-end over a real socket.
    const sockets: NodeWebSocket[] = [];
    class RealPortWebSocket extends NodeWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url.replace(/^ws:\/\/[^/]+/, `ws://localhost:${port}`), protocols);
        sockets.push(this);
      }
    }
    (globalThis as any).WebSocket = RealPortWebSocket;

    await import('../../../src/output/output.js');

    const root = document.getElementById('output-root')!;
    await vi.waitFor(() => {
      expect(root.textContent).toMatch(/For God so loved the world/);
    });

    // The removed fetch('/api/state') would have hit this spy (and rejected, per the
    // rejection above) had it still been present. Its absence is the fix.
    expect(fetchSpy).not.toHaveBeenCalled();

    (globalThis as any).WebSocket = NoopWebSocket;
    sockets.forEach((socket) => socket.terminate());
  });
});
