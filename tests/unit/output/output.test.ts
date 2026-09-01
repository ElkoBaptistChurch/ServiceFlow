import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket as NodeWebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySchema } from '../../../src/main/db/schema';
import { seedDefaultOutputStyles } from '../../../src/main/db/outputStylesRepository';
import { addStagedItem } from '../../../src/main/db/stagedItemsRepository';
import { setLiveState } from '../../../src/main/db/liveStateRepository';
import { createServer, ServerHandle } from '../../../src/main/server/server';

const outputCssPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/output/output.css'
);

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

// A fake, in-memory WebSocket. The tests below drive output.js's fit/resize/reconnect
// logic directly by feeding it synthetic frames, rather than through a real server socket
// -- what matters for these bugs is output.js's own reaction to events, not the transport.
class FakeSocket {
  static instances: FakeSocket[] = [];
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  readyState = 0;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
  send() {}
  emit(type: string, ev: unknown) {
    (this.listeners[type] ?? []).forEach((cb) => cb(ev));
  }
}

function pushLiveUpdate(socket: FakeSocket, payload: unknown) {
  socket.emit('message', { data: JSON.stringify({ type: 'live_update', payload }) });
}

async function loadOutputJs() {
  await import('../../../src/output/output.js');
  return FakeSocket.instances[0];
}

describe('output.js (O-02/O-04/O-05/O-06/O-07/O-08/O-09: render orchestration)', () => {
  const baseVerse = {
    contentType: 'bible',
    text: 'For God so loved the world.',
    reference: 'John 3:16',
    styleId: 1,
    hidden: false,
  };

  let style: HTMLStyleElement;

  beforeEach(() => {
    FakeSocket.instances = [];
    (globalThis as any).WebSocket = FakeSocket;
    document.body.innerHTML = `
      <div id="output-root" class="output-root hidden"></div>
      <div id="connection-indicator" class="connection-indicator" hidden></div>
    `;
    style = document.createElement('style');
    style.textContent = readFileSync(outputCssPath, 'utf8');
    document.head.appendChild(style);

    // jsdom performs no real layout, so getBoundingClientRect/innerHeight need stubbing
    // to exercise the offset-aware height budget (O-09). Model the box's bottom edge the
    // same way the real CSS does: flush to the frame for the default presets, 15% up for
    // the centered ones.
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        const centered = /(?:bible|song)-centered/.test(this.className);
        const bottom = centered ? window.innerHeight * 0.85 : window.innerHeight;
        return { bottom, top: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      },
    });
  });

  afterEach(() => {
    document.head.removeChild(style);
    vi.useRealTimers();
  });

  it('fits down from the preset font size, not a fixed maximum', async () => {
    const socket = await loadOutputJs();

    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-classic' });
    expect((document.querySelector('.output-text') as HTMLElement).style.fontSize).toBe('42px');

    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-bold' });
    expect((document.querySelector('.output-text') as HTMLElement).style.fontSize).toBe('48px');

    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-minimal' });
    expect((document.querySelector('.output-text') as HTMLElement).style.fontSize).toBe('34px');
  });

  it('shrinks or wraps a token wider than the box', async () => {
    const socket = await loadOutputJs();
    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-classic' });
    const textEl = document.querySelector('.output-text') as HTMLElement;
    // The fitter only ever measured height; a single overlong token needs the CSS to
    // wrap it, since scrollHeight alone can't detect horizontal overflow.
    expect(getComputedStyle(textEl).overflowWrap).toBe('break-word');
  });

  it('keeps the reference visible when the verse cannot fit', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('output-text') ? 5000 : 0;
      },
    });
    try {
      const socket = await loadOutputJs();
      pushLiveUpdate(socket, { ...baseVerse, text: 'x'.repeat(3000), templateKey: 'bible-classic' });

      const textEl = document.querySelector('.output-text') as HTMLElement;
      const referenceEl = document.querySelector('.output-reference') as HTMLElement;
      const truncatedEl = document.querySelector('.output-truncated') as HTMLElement;

      expect(referenceEl.textContent).toBe('John 3:16');
      expect(textEl.style.maxHeight).not.toBe('');
      expect(truncatedEl.hidden).toBe(false);
    } finally {
      if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalDescriptor);
    }
  });

  it('coalesces rapid resize events into a single refit', async () => {
    const socket = await loadOutputJs();
    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-classic' });
    const before = document.querySelector('.output-text');

    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
    // renderState always rebuilds the subtree, so an un-debounced handler would already
    // have replaced this node several times over.
    expect(document.querySelector('.output-text')).toBe(before);

    vi.advanceTimersByTime(100);
    expect(document.querySelector('.output-text')).not.toBe(before);
  });

  it('ignores a malformed message frame', async () => {
    const socket = await loadOutputJs();
    expect(() => socket.emit('message', { data: 'not json' })).not.toThrow();
  });

  it('backs off between reconnection attempts', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const socket = await loadOutputJs();

    socket.emit('close', {});
    const firstDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(firstDelay).toBeGreaterThanOrEqual(1000);
    expect(firstDelay).toBeLessThan(1000 * 1.2);

    vi.advanceTimersByTime(firstDelay);
    FakeSocket.instances.at(-1)!.emit('close', {});
    const secondDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    expect(secondDelay).toBeGreaterThan(firstDelay);

    let lastDelay = secondDelay;
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(lastDelay);
      FakeSocket.instances.at(-1)!.emit('close', {});
      lastDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
    }
    expect(lastDelay).toBeLessThanOrEqual(30000 * 1.2);
  });

  it('keeps the top of the frame clear for offset presets', async () => {
    const socket = await loadOutputJs();

    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-classic' });
    // bottom: 0 -> box bottom at 1000, top clearance 450 -> budget 550.
    expect((document.querySelector('.output-text') as HTMLElement).style.maxHeight).toBe('550px');

    pushLiveUpdate(socket, { ...baseVerse, templateKey: 'bible-centered' });
    // bottom: 15% -> box bottom at 850, same top clearance -> a tighter 400px budget.
    expect((document.querySelector('.output-text') as HTMLElement).style.maxHeight).toBe('400px');
  });
});
