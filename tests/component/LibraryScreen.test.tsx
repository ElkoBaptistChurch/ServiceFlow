import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LibraryScreen from '../../src/renderer/components/LibraryScreen';

beforeEach(() => {
  (window as any).api = {
    findSongsByTitle: vi.fn().mockResolvedValue([]),
    findSongsByQuery: vi.fn().mockResolvedValue([]),
    getBlocksForSong: vi.fn().mockResolvedValue([]),
    listTranslations: vi.fn().mockResolvedValue([
      { code: 'KJV', name: 'King James Version', source: 'bundled', licenseNote: null, bookCount: 66, verseCount: 31102 },
    ]),
  };
});

describe('LibraryScreen', () => {
  it('shows Songs as the selected content type and renders the song library panel', async () => {
    render(<LibraryScreen />);
    expect(screen.getByRole('button', { name: 'Songs' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: /new song/i })).toBeInTheDocument();
  });

  it('has a Bibles tab that manages translations', async () => {
    render(<LibraryScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Bibles' }));
    expect(screen.getByRole('button', { name: 'Bibles' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('King James Version')).toBeInTheDocument();
  });

  it('asks before leaving the song editor with unsaved changes for the Bibles tab', async () => {
    (window.api.findSongsByQuery as any).mockResolvedValue([{ id: 1, title: 'Amazing Grace', ccliNumber: null }]);
    const registerDirtyGuard = vi.fn();
    render(<LibraryScreen registerDirtyGuard={registerDirtyGuard} />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    fireEvent.change(await screen.findByDisplayValue('Amazing Grace'), { target: { value: 'Edited' } });

    fireEvent.click(screen.getByRole('button', { name: 'Bibles' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('King James Version')).toBeInTheDocument();
    // The unmounted editor's guard must not keep blocking App's view switches.
    const lastGuard = registerDirtyGuard.mock.calls[registerDirtyGuard.mock.calls.length - 1][0];
    const proceed = vi.fn();
    lastGuard(proceed);
    await waitFor(() => expect(proceed).toHaveBeenCalled());
  });
});
