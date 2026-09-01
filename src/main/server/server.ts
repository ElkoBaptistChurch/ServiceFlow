import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import { getLiveState } from '../db/liveStateRepository';
import { getActiveStyle } from '../db/outputStylesRepository';
import { ContentType, OutputPayload } from '../../shared/types';

const EMPTY_PAYLOAD: OutputPayload = {
  contentType: null,
  text: null,
  reference: null,
  styleId: null,
  templateKey: null,
  hidden: false,
};

/**
 * Resolves the style to render with, always as the mapped (camelCase) `OutputStyle`
 * shape -- whether the caller pinned a specific style or we fall back to the
 * content type's active style. Both branches must agree on field names, or
 * `buildOutputPayload` risks reading `templateKey` off one shape and getting
 * `undefined` on the other.
 */
function resolveStyle(db: Database.Database, styleId: number | null, contentType: ContentType) {
  if (!styleId) return getActiveStyle(db, contentType);
  const row = db.prepare(`SELECT * FROM output_styles WHERE id = ?`).get(styleId) as any;
  return row ? { id: row.id as number, templateKey: row.template_key as string } : undefined;
}

export function buildOutputPayload(db: Database.Database): OutputPayload {
  const live = getLiveState(db);
  if (!live.stagedItemId || !live.verseOrBlockId) return EMPTY_PAYLOAD;

  const stagedItem = db.prepare(`SELECT * FROM staged_items WHERE id = ?`).get(live.stagedItemId) as any;
  if (!stagedItem) return EMPTY_PAYLOAD;

  const contentType = stagedItem.type as ContentType;
  const style = resolveStyle(db, live.styleId, contentType);

  // `reference` comes from liveStateRepository so the operator banner, the OBS output
  // and the tests can never disagree about what is on screen.
  const base = {
    reference: live.reference,
    styleId: style?.id ?? null,
    templateKey: style?.templateKey ?? null,
    hidden: live.hidden,
  };

  if (contentType === 'bible') {
    const verse = db.prepare(`SELECT text FROM bible_verses WHERE id = ?`).get(live.verseOrBlockId) as any;
    if (!verse) return EMPTY_PAYLOAD;
    return { contentType: 'bible', text: verse.text, ...base };
  }

  const block = db.prepare(`SELECT text FROM song_blocks WHERE id = ?`).get(live.verseOrBlockId) as any;
  if (!block) return EMPTY_PAYLOAD;
  return { contentType: 'song', text: block.text, ...base };
}

export interface ServerHandle {
  start(port: number): Promise<number>;
  stop(): Promise<void>;
  broadcastLiveUpdate(): void;
  getClientCount(): number;
}

export interface CreateServerOptions {
  /** Overridable only so tests don't have to wait out a real 30s heartbeat cycle. */
  heartbeatIntervalMs?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

interface HeartbeatSocket extends WebSocket {
  isAlive?: boolean;
}

export function createServer(db: Database.Database, options: CreateServerOptions = {}): ServerHandle {
  const app = express();
  app.use('/output', express.static(path.join(__dirname, '..', '..', 'output')));
  app.get('/api/state', (_req, res) => {
    res.json(buildOutputPayload(db));
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // `ws` forwards the underlying http.Server's own 'error' events (e.g. EADDRINUSE from a
  // failed listen()) onto the WebSocketServer itself. With no listener here, Node's default
  // EventEmitter behaviour for an unhandled 'error' event throws synchronously -- and it does
  // so from *inside* the httpServer 'error' emit, ahead of start()'s own reject() listener,
  // killing the whole Electron main process before the OS-assigned-port fallback ever runs.
  // During a start() attempt this swallows that expected EADDRINUSE; once startup succeeds
  // the swallow window closes so a later error (EMFILE, adapter teardown) is at least logged
  // instead of vanishing forever (M-11).
  let inStartupWindow = true;
  wss.on('error', (err: Error) => {
    if (inStartupWindow) return;
    console.error('WebSocketServer error', err);
  });

  wss.on('connection', (socket: WebSocket) => {
    const heartbeatSocket = socket as HeartbeatSocket;
    heartbeatSocket.isAlive = true;
    heartbeatSocket.on('pong', () => {
      heartbeatSocket.isAlive = true;
    });
    // A malformed frame from any device on the LAN (the server binds 0.0.0.0 with no auth)
    // makes `ws`'s receiver emit 'error' on this socket. With no listener here, Node's
    // default EventEmitter behaviour throws synchronously and kills the whole process.
    socket.on('error', () => socket.terminate());
    socket.send(JSON.stringify({ type: 'live_update', payload: buildOutputPayload(db) }));
  });

  // Half-open connections (the peer vanished without a clean TCP close, common on flaky
  // venue Wi-Fi) never fire 'close' and sit in wss.clients forever, silently absorbing every
  // broadcast until the OS's own TCP retransmit timeout (10-20 min on Windows) reaps them.
  // Ping every client on each tick and terminate whichever didn't pong since the last one.
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const heartbeatSocket = client as HeartbeatSocket;
      if (heartbeatSocket.isAlive === false) {
        heartbeatSocket.terminate();
        return;
      }
      heartbeatSocket.isAlive = false;
      heartbeatSocket.ping();
    });
  }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);

  function broadcastLiveUpdate(): void {
    const message = JSON.stringify({ type: 'live_update', payload: buildOutputPayload(db) });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  const handle = {
    start(port: number) {
      inStartupWindow = true;
      return new Promise<number>((resolve, reject) => {
        const onError = (err: Error) => {
          httpServer.removeListener('error', onError);
          reject(err);
        };
        httpServer.once('error', onError);
        httpServer.listen(port, '0.0.0.0', () => {
          httpServer.removeListener('error', onError);
          inStartupWindow = false;
          const address = httpServer.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    stop() {
      return new Promise<void>((resolve) => {
        clearInterval(heartbeatInterval);
        // wss.close() only waits for wss.clients to drain, and httpServer.close() only waits
        // for upgraded connections to end -- neither callback ever fires while a client is
        // still connected. Terminate every client first so quitting can't hang forever (M-06).
        for (const client of wss.clients) client.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
    broadcastLiveUpdate,
    getClientCount() {
      return wss.clients.size;
    },
    // Not part of the ServerHandle interface -- exposed only so the M-11 regression test can
    // emit a post-startup 'error' on the real httpServer without a live EMFILE to provoke one.
    httpServer,
  };
  return handle;
}
