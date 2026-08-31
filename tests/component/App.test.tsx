import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../src/renderer/App';

const EMPTY_LIVE = {
  stagedItemId: null,
  verseOrBlockId: null,
  styleId: null,
  hidden: false,
  updatedAt: '',
  reference: null,
};

beforeEach(() => {
  (window as any).api = {
    getStagedItems: vi.fn().mockResolvedValue([]),
    getLiveState: vi.fn().mockResolvedValue(EMPTY_LIVE),
    setOutputHidden: vi.fn().mockResolvedValue({ ...EMPTY_LIVE, hidden: true }),
    onLiveStateChanged: vi.fn().mockReturnValue(() => {}),
    getServerUrls: vi.fn().mockResolvedValue({ local: 'http://localhost:4180/output', lan: null }),
    getOutputStyles: vi.fn().mockResolvedValue([]),
    listTranslations: vi.fn().mockResolvedValue(['KJV']),
    getActiveTranslation: vi.fn().mockResolvedValue('KJV'),
    findBibleBooks: vi.fn().mockResolvedValue([]),
    findSongsByTitle: vi.fn().mockResolvedValue([]),
    getBlocksForSong: vi.fn().mockResolvedValue([]),
    getVersesForChapter: vi.fn().mockResolvedValue([]),
    unstageItem: vi.fn().mockResolvedValue(undefined),
    setLiveState: vi.fn().mockResolvedValue(EMPTY_LIVE),
  };
});

describe('App', () => {
  it('renders the operator view with search, staged list, and live banner', async () => {
    render(<App />);
    expect(await screen.findByText(/nothing live/i)).toBeInTheDocument();
    expect(screen.getByText('Bible')).toBeInTheDocument();
    expect(screen.getByText('Songs')).toBeInTheDocument();
  });

  it('switches to the settings view', async () => {
    render(<App />);
    screen.getByRole('button', { name: /settings/i }).click();
    expect(await screen.findByText(/OBS Browser Source URLs/i)).toBeInTheDocument();
  });

  it('focuses the search box when "/" is pressed', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText(/search/i);
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(window, { key: '/' });
    expect(input).toHaveFocus();
  });

  it('jumps to a staged item\'s content pane when its number key is pressed', async () => {
    (window.api.getStagedItems as any).mockResolvedValue([
      { id: 1, type: 'bible', refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' },
      { id: 2, type: 'song', refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
    ]);
    (window.api.getBlocksForSong as any).mockResolvedValue([
      { id: 200, songId: 1, label: 'Verse 1', text: 'Amazing grace', displayOrder: 0 },
    ]);
    render(<App />);
    await screen.findByText('John 3 (KJV)');

    fireEvent.keyDown(window, { key: '2' });

    expect(await screen.findByText(/Amazing grace/)).toBeInTheDocument();
  });

  it('blanks the output on Escape and says so in the banner', async () => {
    render(<App />);
    await screen.findByText(/nothing live/i);

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(window.api.setOutputHidden).toHaveBeenCalledWith(true));
  });

  it('does not fire shortcuts while the operator is typing', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText(/search/i);
    input.focus();

    fireEvent.keyDown(input, { key: '2' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(window.api.setOutputHidden).not.toHaveBeenCalled();
  });

  // The spec requires DB write failures to be visible, not buried in devtools.
  it('surfaces a failed main-process call as a banner', async () => {
    render(<App />);
    await screen.findByText(/nothing live/i);

    // The dispatched event is a manual simulation, not a real unhandled rejection, so the
    // underlying promise needs its own no-op catch or Node reports a genuine unhandled
    // rejection for it and fails the run even though every assertion below passes.
    const rejectedPromise = Promise.reject(new Error('SQLITE_FULL: database or disk is full'));
    rejectedPromise.catch(() => {});
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: rejectedPromise,
        reason: new Error('SQLITE_FULL: database or disk is full'),
        cancelable: true,
      })
    );

    expect(await screen.findByText(/disk is full/i)).toBeInTheDocument();
  });

  // I2: removing the active staged item must not leave the content pane rendering a
  // ghost whose click could carry a deleted staged-item id into setLiveState -- which,
  // if a DIFFERENT item was actually live, would blank the OBS output entirely.
  it('clears the content pane when the active staged item is removed from the list', async () => {
    let stagedItems = [
      { id: 1, type: 'bible' as const, refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' },
      { id: 2, type: 'song' as const, refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
    ];
    (window.api.getStagedItems as any).mockImplementation(() => Promise.resolve(stagedItems));
    (window.api.unstageItem as any).mockImplementation((id: number) => {
      stagedItems = stagedItems.filter((item) => item.id !== id);
      return Promise.resolve(undefined);
    });
    (window.api.getVersesForChapter as any).mockResolvedValue([
      { id: 100, bookId: 7, chapter: 3, verse: 16, text: 'For God so loved the world.' },
    ]);

    render(<App />);
    await screen.findByText('John 3 (KJV)');

    fireEvent.click(screen.getByText('John 3 (KJV)'));
    expect(await screen.findByText(/For God so loved the world/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove john 3/i }));

    await waitFor(() => expect(window.api.unstageItem).toHaveBeenCalledWith(1));
    // The ghost must be gone: no stale verses rendered, and the pane falls back to its
    // "nothing selected" state rather than something clickable that could carry id 1.
    await waitFor(() => expect(screen.queryByText(/For God so loved the world/)).not.toBeInTheDocument());
    expect(screen.getByText(/no item selected/i)).toBeInTheDocument();
  });

  // M2: crash recovery restores the live item at the persistence layer, but the content
  // pane and arrow keys are dead until the operator clicks a staged entry again unless
  // App also re-selects that item as active on startup.
  it('makes the previously-live item active on startup, without any click', async () => {
    (window.api.getStagedItems as any).mockResolvedValue([
      { id: 1, type: 'bible' as const, refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' },
      { id: 2, type: 'song' as const, refId: 1, chapter: null, position: 1, label: 'Amazing Grace' },
    ]);
    (window.api.getLiveState as any).mockResolvedValue({
      stagedItemId: 2,
      verseOrBlockId: 201,
      styleId: null,
      hidden: false,
      updatedAt: '2026-08-30T00:00:00.000Z',
      reference: 'Amazing Grace',
    });
    (window.api.getBlocksForSong as any).mockResolvedValue([
      { id: 201, songId: 1, label: 'V1', text: 'Amazing grace, how sweet the sound', displayOrder: 0 },
    ]);

    render(<App />);

    // No click on the staged list -- the content pane must populate on its own.
    expect(await screen.findByText(/Amazing grace, how sweet the sound/)).toBeInTheDocument();
  });

  // M4: the Esc handler must not read a stale `liveState.hidden` closure. Two presses
  // fired before the first IPC round trip resolves must alternate (hide, then restore),
  // not both send the same value and leave the output stuck blank.
  it('alternates output visibility on two rapid Esc presses instead of repeating the same value', async () => {
    const pending: Array<() => void> = [];
    (window.api.setOutputHidden as any) = vi.fn((hidden: boolean) => {
      return new Promise((resolve) => {
        pending.push(() => resolve({ ...EMPTY_LIVE, hidden }));
      });
    });

    render(<App />);
    await screen.findByText(/nothing live/i);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(window.api.setOutputHidden).toHaveBeenCalledTimes(2);
    expect(window.api.setOutputHidden).toHaveBeenNthCalledWith(1, true);
    expect(window.api.setOutputHidden).toHaveBeenNthCalledWith(2, false);

    // Flush the deferred responses so no state update lands after the test/cleanup.
    pending.forEach((resolve) => resolve());
    await waitFor(() => {});
  });
});
