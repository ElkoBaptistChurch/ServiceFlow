import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/main/index.ts runs real side effects at import time (app.requestSingleInstanceLock(),
// then app.whenReady().then(createWindow)), so every scenario needs a fresh module registry
// and its own electron/db/server/ipc mocks, built with vi.doMock + a dynamic import rather
// than the usual static vi.mock -- a single top-level vi.mock would be shared (and its call
// counts polluted) across every test in this file.

interface ElectronMock {
  app: {
    requestSingleInstanceLock: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    whenReady: ReturnType<typeof vi.fn>;
    getPath: ReturnType<typeof vi.fn>;
  };
  BrowserWindow: ReturnType<typeof vi.fn>;
  dialog: { showErrorBox: ReturnType<typeof vi.fn> };
  browserWindowInstance: {
    on: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
  };
}

function mockElectron(lockAcquired: boolean): ElectronMock {
  const browserWindowInstance = {
    on: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  };
  const mock: ElectronMock = {
    app: {
      requestSingleInstanceLock: vi.fn(() => lockAcquired),
      quit: vi.fn(),
      on: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      getPath: vi.fn(() => '/fake/userData'),
    },
    BrowserWindow: vi.fn(() => browserWindowInstance),
    dialog: { showErrorBox: vi.fn() },
    browserWindowInstance,
  };
  vi.doMock('electron', () => ({
    app: mock.app,
    BrowserWindow: mock.BrowserWindow,
    dialog: mock.dialog,
  }));
  return mock;
}

function mockMainProcessModules(opts: { openDatabaseImpl?: () => unknown } = {}) {
  const openDatabase = vi.fn(opts.openDatabaseImpl ?? (() => ({ fakeDb: true })));
  const seedDefaultOutputStyles = vi.fn();
  const serverHandle = {
    start: vi.fn().mockResolvedValue(4180),
    stop: vi.fn().mockResolvedValue(undefined),
    broadcastLiveUpdate: vi.fn(),
  };
  const createServer = vi.fn(() => serverHandle);
  const registerIpcHandlers = vi.fn();

  vi.doMock('../../../src/main/db/client', () => ({ openDatabase }));
  vi.doMock('../../../src/main/db/outputStylesRepository', () => ({ seedDefaultOutputStyles }));
  vi.doMock('../../../src/main/server/server', () => ({ createServer }));
  vi.doMock('../../../src/main/ipc/handlers', () => ({ registerIpcHandlers }));

  return { openDatabase, seedDefaultOutputStyles, createServer, serverHandle, registerIpcHandlers };
}

beforeEach(() => {
  vi.resetModules();
});

describe('main/index.ts startup orchestration', () => {
  // C1: a second instance must not touch the database or start a server at all -- that is
  // exactly how one instance's banner and the OBS output (bound to the OTHER instance's
  // WebSocket clients) end up disagreeing indefinitely.
  it('quits immediately without opening the database or starting a server when the single-instance lock is lost', async () => {
    const electron = mockElectron(false);
    const modules = mockMainProcessModules();

    await import('../../../src/main/index');

    expect(electron.app.quit).toHaveBeenCalled();
    expect(electron.app.whenReady).not.toHaveBeenCalled();
    expect(modules.openDatabase).not.toHaveBeenCalled();
    expect(modules.createServer).not.toHaveBeenCalled();
    expect(electron.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
  });

  it('focuses (and restores) the existing window when a second instance launches', async () => {
    const electron = mockElectron(true);
    mockMainProcessModules();

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(electron.BrowserWindow).toHaveBeenCalled();
    });

    const secondInstanceCall = electron.app.on.mock.calls.find(([event]) => event === 'second-instance');
    expect(secondInstanceCall).toBeDefined();
    const secondInstanceHandler = secondInstanceCall![1] as () => void;

    electron.browserWindowInstance.isMinimized.mockReturnValue(true);
    secondInstanceHandler();

    expect(electron.browserWindowInstance.restore).toHaveBeenCalled();
    expect(electron.browserWindowInstance.focus).toHaveBeenCalled();
  });

  // I3: a throw anywhere on the startup path (corrupt DB, read-only userData, an ABI
  // mismatch) must become a visible dialog and a clean quit, not an unhandled rejection
  // that kills the process with no window and no clue.
  it('shows an error dialog and quits instead of crashing when startup throws', async () => {
    const electron = mockElectron(true);
    mockMainProcessModules({
      openDatabaseImpl: () => {
        throw new Error('SQLITE_CORRUPT: file is not a database');
      },
    });

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await import('../../../src/main/index');

      await vi.waitFor(() => {
        expect(electron.dialog.showErrorBox).toHaveBeenCalled();
      });

      expect(electron.dialog.showErrorBox.mock.calls[0][1]).toMatch(/SQLITE_CORRUPT/);
      expect(electron.app.quit).toHaveBeenCalled();

      // Give a real unhandled rejection (if the bug were present) a chance to be reported
      // before asserting none arrived.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });
});
