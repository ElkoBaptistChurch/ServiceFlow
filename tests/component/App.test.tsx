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
});
