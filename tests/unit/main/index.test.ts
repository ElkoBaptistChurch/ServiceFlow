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

function mockMainProcessModules(
  opts: {
    openDatabaseImpl?: () => unknown;
    theme?: 'light' | 'dark';
    /** Defaults to "just now" (fresh) so M-04's staleness check is opt-in per test. */
    liveStateUpdatedAt?: string;
    /** The value settingsRepo.getSetting returns for the last-bound-port key. */
    storedPort?: string | null;
  } = {}
) {
  const openDatabase = vi.fn(opts.openDatabaseImpl ?? (() => ({ fakeDb: true })));
  const seedDefaultOutputStyles = vi.fn();
  const serverHandle = {
    start: vi.fn().mockResolvedValue(4180),
    stop: vi.fn().mockResolvedValue(undefined),
    broadcastLiveUpdate: vi.fn(),
    getClientCount: vi.fn(() => 0),
  };
  const createServer = vi.fn(() => serverHandle);
  const registerIpcHandlers = vi.fn();
  const getTheme = vi.fn(() => opts.theme ?? 'light');
  const getLiveState = vi.fn(() => ({
    stagedItemId: null,
    verseOrBlockId: null,
    styleId: null,
    hidden: false,
    updatedAt: opts.liveStateUpdatedAt ?? new Date().toISOString(),
    reference: null,
  }));
  const setOutputHidden = vi.fn();
  const clearLiveSelection = vi.fn();
  const clearStagedItems = vi.fn();
  const getSetting = vi.fn(() => opts.storedPort ?? null);
  const setSetting = vi.fn();

  vi.doMock('../../../src/main/db/client', () => ({ openDatabase }));
  vi.doMock('../../../src/main/db/outputStylesRepository', () => ({ seedDefaultOutputStyles }));
  vi.doMock('../../../src/main/db/liveStateRepository', () => ({ getLiveState, setOutputHidden, clearLiveSelection }));
  vi.doMock('../../../src/main/db/stagedItemsRepository', () => ({ clearStagedItems }));
  vi.doMock('../../../src/main/db/settingsRepository', () => ({ getSetting, setSetting, getTheme }));
  vi.doMock('../../../src/main/server/server', () => ({ createServer }));
  vi.doMock('../../../src/main/ipc/handlers', () => ({ registerIpcHandlers }));

  return {
    openDatabase,
    seedDefaultOutputStyles,
    createServer,
    serverHandle,
    registerIpcHandlers,
    getTheme,
    getLiveState,
    setOutputHidden,
    clearLiveSelection,
    clearStagedItems,
    getSetting,
    setSetting,
  };
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

  // Theme persistence: the operator works in a darkened A/V booth, so a dark-themed
  // window must never flash white on launch. The stored theme has to be read and
  // turned into the window's backgroundColor at construction time -- not fetched by
  // the renderer after the window is already visible.
  it('reads the persisted theme before constructing the window and uses it for backgroundColor (dark)', async () => {
    const electron = mockElectron(true);
    const modules = mockMainProcessModules({ theme: 'dark' });

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(electron.BrowserWindow).toHaveBeenCalled();
    });

    expect(modules.getTheme).toHaveBeenCalled();
    const constructorArgs = electron.BrowserWindow.mock.calls[0][0];
    expect(constructorArgs.backgroundColor).toBe('#17140f');
  });

  it('uses the light background color when the persisted theme is light', async () => {
    const electron = mockElectron(true);
    mockMainProcessModules({ theme: 'light' });

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(electron.BrowserWindow).toHaveBeenCalled();
    });

    const constructorArgs = electron.BrowserWindow.mock.calls[0][0];
    expect(constructorArgs.backgroundColor).toBe('#faf7f2');
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

  // Regression for M-14: the single-instance lock's whole purpose is a volunteer double-
  // clicking the Start Menu shortcut while the first launch is still starting up. Firing
  // 'second-instance' before mainWindowRef exists must not silently no-op.
  it('focuses the window for a second instance that arrives during startup', async () => {
    const electron = mockElectron(true);
    mockMainProcessModules();

    await import('../../../src/main/index');

    const secondInstanceCall = electron.app.on.mock.calls.find(([event]) => event === 'second-instance');
    expect(secondInstanceCall).toBeDefined();
    const secondInstanceHandler = secondInstanceCall![1] as () => void;
    // Fire it before BrowserWindow has been constructed -- createWindow's awaited
    // server.start() has not resolved yet at this point.
    secondInstanceHandler();

    await vi.waitFor(() => {
      expect(electron.BrowserWindow).toHaveBeenCalled();
    });

    expect(electron.browserWindowInstance.focus).toHaveBeenCalled();
  });

  // Regression for M-04: without an age bound, last week's live_state resurfaces on OBS
  // the instant it reconnects, well before the service the volunteer is setting up for.
  it('does not restore live state from a previous session', async () => {
    mockElectron(true);
    const staleUpdatedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h old
    const modules = mockMainProcessModules({ liveStateUpdatedAt: staleUpdatedAt });

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(modules.setOutputHidden).toHaveBeenCalledWith(expect.anything(), true);
    });
  });

  // Only the "hidden" blanking decision is age-based; the staged list and live selection
  // are wiped unconditionally on every launch regardless of freshness (see the reset test
  // below), so this only covers whether a fresh session gets auto-blanked.
  it('does not auto-blank a recent live state', async () => {
    mockElectron(true);
    const freshUpdatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m old
    const modules = mockMainProcessModules({ liveStateUpdatedAt: freshUpdatedAt });

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(modules.createServer).toHaveBeenCalled();
    });
    expect(modules.setOutputHidden).not.toHaveBeenCalled();
  });

  // "Ready for today" must never open onto a previous service's leftovers -- unlike the
  // hidden-blanking check above, this reset is unconditional on every launch.
  it('clears the staged list and live selection on every launch', async () => {
    mockElectron(true);
    const freshUpdatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const modules = mockMainProcessModules({ liveStateUpdatedAt: freshUpdatedAt });

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(modules.clearStagedItems).toHaveBeenCalled();
    });
    expect(modules.clearLiveSelection).toHaveBeenCalled();
  });

  // Regression for M-05: without persisting the bound port, a fallback port freed up the
  // following week means the app silently binds DEFAULT_PORT again while OBS is still
  // pointed at last week's fallback URL.
  it('reuses the previously bound port on the next launch', async () => {
    mockElectron(true);
    const modules = mockMainProcessModules({ storedPort: '51234' });

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(modules.serverHandle.start).toHaveBeenCalledWith(51234);
    });
    await vi.waitFor(() => {
      expect(modules.setSetting).toHaveBeenCalledWith(expect.anything(), expect.any(String), '4180');
    });
  });

  // Regression for M-02 (depends on M-06): quitting with a verse live must not leave it
  // burned on the stream indefinitely -- only a manual OBS "Refresh browser source" clears
  // it today.
  it('broadcasts a blank payload and stops the server on quit', async () => {
    const electron = mockElectron(true);
    const modules = mockMainProcessModules();

    await import('../../../src/main/index');

    await vi.waitFor(() => {
      expect(modules.createServer).toHaveBeenCalled();
    });

    const beforeQuitCall = electron.app.on.mock.calls.find(([event]) => event === 'before-quit');
    expect(beforeQuitCall).toBeDefined();
    const beforeQuitHandler = beforeQuitCall![1] as (e: { preventDefault: () => void }) => void;
    const event = { preventDefault: vi.fn() };
    beforeQuitHandler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(modules.setOutputHidden).toHaveBeenCalledWith(expect.anything(), true);
      expect(modules.serverHandle.broadcastLiveUpdate).toHaveBeenCalled();
      expect(modules.serverHandle.stop).toHaveBeenCalled();
      expect(electron.app.quit).toHaveBeenCalled();
    });
  });
});
