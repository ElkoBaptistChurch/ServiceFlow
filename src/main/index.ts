import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { openDatabase } from './db/client';
import { seedDefaultOutputStyles } from './db/outputStylesRepository';
import { createServer } from './server/server';
import { registerIpcHandlers } from './ipc/handlers';

const DEFAULT_PORT = 4180;

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

  registerIpcHandlers(db, server, mainWindow, port);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
