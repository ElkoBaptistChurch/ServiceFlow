import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { openDatabase } from './db/client';
import { seedDefaultOutputStyles } from './db/outputStylesRepository';
import { createServer } from './server/server';
import { registerIpcHandlers } from './ipc/handlers';

const DEFAULT_PORT = 4180;

let mainWindowRef: BrowserWindow | null = null;

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
    }
  });
}

async function createWindow() {
  const dbPath = path.join(app.getPath('userData'), 'serviceflow.db');
  const db = openDatabase(dbPath);
  seedDefaultOutputStyles(db);

  const server = createServer(db);
  let port: number;
  try {
    port = await server.start(DEFAULT_PORT);
  } catch (err) {
    // v1 has no port field in Settings, so never tell the operator to change one.
    // Fall back to a free port and point them at the (new) URL Settings will show.
    port = await server.start(0);
    dialog.showErrorBox(
      'ServiceFlow is using a different port',
      `Port ${DEFAULT_PORT} was unavailable (${(err as Error).message}), so ServiceFlow started on ` +
        `port ${port} instead.\n\nThe OBS Browser Source URL has changed — open Settings, copy the ` +
        'URL shown there, and paste it into your OBS Browser Source.'
    );
  }

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
