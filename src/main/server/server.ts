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
}

export function createServer(db: Database.Database): ServerHandle {
  const app = express();
  app.use('/output', express.static(path.join(__dirname, '..', '..', 'output')));
  app.get('/api/state', (_req, res) => {
    res.json(buildOutputPayload(db));
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: 'live_update', payload: buildOutputPayload(db) }));
  });

  function broadcastLiveUpdate(): void {
    const message = JSON.stringify({ type: 'live_update', payload: buildOutputPayload(db) });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  return {
    start(port: number) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '0.0.0.0', () => {
          const address = httpServer.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
    broadcastLiveUpdate,
  };
}
