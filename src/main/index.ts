import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import Database from 'better-sqlite3';
import { openDatabase } from './db/client';
import { seedDefaultOutputStyles } from './db/outputStylesRepository';
import { getLiveState, setOutputHidden } from './db/liveStateRepository';
import * as settingsRepo from './db/settingsRepository';
import { createServer, ServerHandle } from './server/server';
import { registerIpcHandlers } from './ipc/handlers';

const DEFAULT_PORT = 4180;
const SETTING_LAST_PORT = 'last_bound_port';

// A verse left live across a service boundary (last week's, or a crash mid-service) must
// never resurface on the next launch's pre-service walk-in -- but a crash or window close
// *during* the same service should still find its selection intact, which is what the
// App.tsx recovery effect is for. Four hours comfortably spans an intermission or a tech
// hiccup while guaranteeing next Sunday always starts blank.
const STALE_LIVE_STATE_MS = 4 * 60 * 60 * 1000;

let mainWindowRef: BrowserWindow | null = null;
// Set when 'second-instance' fires before mainWindowRef exists (a volunteer double-clicking
// the shortcut while the first launch is still starting up) so the focus isn't dropped.
let pendingFocus = false;
let serverRef: ServerHandle | null = null;
let dbRef: Database.Database | null = null;
let quitting = false;

// A volunteer double-clicking the Start Menu shortcut while the first instance is still
// opening its (slow) window is common, not exotic. Without a single-instance lock, the
// second process opens the SAME database, fails to bind the well-known port, falls back
// to a random one, and broadcasts live updates only to ITS OWN WebSocket clients -- while
// OBS stays connected to the first instance. The operator's banner and the stream can then
// disagree indefinitely, which is exactly what this app exists to prevent. So the lock must
// be taken before anything else touches the database or the network.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindowRef) {
      if (mainWindowRef.isMinimized()) mainWindowRef.restore();
      mainWindowRef.focus();
    } else {
      pendingFocus = true;
    }
  });
}

async function createWindow() {
  const dbPath = path.join(app.getPath('userData'), 'serviceflow.db');
  const db = openDatabase(dbPath);
  dbRef = db;
  seedDefaultOutputStyles(db);

  // See STALE_LIVE_STATE_MS above for why this is an age bound rather than an
  // unconditional clear.
  const live = getLiveState(db);
  if (Date.now() - new Date(live.updatedAt).getTime() > STALE_LIVE_STATE_MS) {
    setOutputHidden(db, true);
  }

  const server = createServer(db);
  serverRef = server;

  // Try the port that bound successfully last launch before DEFAULT_PORT: if last week's
  // fallback port is still what OBS is pointed at, rebinding DEFAULT_PORT the moment it's
  // free again would silently point ServiceFlow at a URL nothing is listening to.
  const storedPort = settingsRepo.getSetting(db, SETTING_LAST_PORT);
  const preferredPort = storedPort ? Number(storedPort) : DEFAULT_PORT;
  let port: number;
  try {
    port = await server.start(preferredPort);
  } catch (err) {
    // v1 has no port field in Settings, so never tell the operator to change one unless we
    // actually had to fall back. Try DEFAULT_PORT next (unless that's what just failed),
    // then a free OS-assigned port.
    const fallbackPort = preferredPort === DEFAULT_PORT ? 0 : DEFAULT_PORT;
    try {
      port = await server.start(fallbackPort);
    } catch {
      port = await server.start(0);
    }
    dialog.showErrorBox(
      'ServiceFlow is using a different port',
      `Port ${preferredPort} was unavailable (${(err as Error).message}), so ServiceFlow started on ` +
        `port ${port} instead.\n\nThe OBS Browser Source URL has changed — open Settings, copy the ` +
        'URL shown there, and paste it into your OBS Browser Source.'
    );
  }
  // Persist whatever port actually bound so next launch tries it first.
  settingsRepo.setSetting(db, SETTING_LAST_PORT, String(port));

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindowRef = mainWindow;
  mainWindow.on('closed', () => {
    mainWindowRef = null;
  });

  if (pendingFocus) {
    pendingFocus = false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  registerIpcHandlers(db, server, mainWindow, port);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

// A throw anywhere on this path (a corrupt database after a hard power-off, a read-only
// userData directory, the better-sqlite3 ABI mismatch the README warns about) would
// otherwise become an unhandled promise rejection -- and Node 20 terminates the process
// for that with no window, no dialog, and no clue for the volunteer who just double-clicked
// the icon. The spec requires database failures to be loud; catch the whole startup path
// (not just openDatabase) and say so before quitting.
if (gotLock) {
  app.whenReady().then(async () => {
    try {
      await createWindow();
    } catch (err) {
      dialog.showErrorBox(
        'ServiceFlow failed to start',
        `ServiceFlow could not start: ${(err as Error).message ?? err}\n\n` +
          'Check that the ServiceFlow data folder is not read-only or corrupted, then try again.'
      );
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Quitting with a verse live otherwise leaves it burned on the stream indefinitely -- it
// survives even a restart because of the staleness check above, so today only a manual OBS
// "Refresh browser source" clears it. Blank the output and let every connected client (and
// the next launch, once persisted) see it before the process actually goes away. `quitting`
// guards against the re-entrant 'before-quit' that app.quit() below would otherwise trigger.
app.on('before-quit', (event) => {
  if (!serverRef || quitting) return;
  quitting = true;
  event.preventDefault();
  const server = serverRef;
  const db = dbRef;
  (async () => {
    if (db) setOutputHidden(db, true);
    server.broadcastLiveUpdate();
    await server.stop();
    app.quit();
  })();
});
