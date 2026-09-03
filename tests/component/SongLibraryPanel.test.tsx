import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SongLibraryPanel from '../../src/renderer/components/SongLibraryPanel';

const songs = [
  { id: 1, title: 'Amazing Grace', ccliNumber: '22025' },
  { id: 2, title: 'How Great Thou Art', ccliNumber: '14181' },
];

const blocksForSong1 = [
  { id: 10, songId: 1, label: 'Verse 1', text: 'Amazing grace, how sweet the sound', displayOrder: 0 },
  { id: 11, songId: 1, label: 'Chorus 1', text: "My chains are gone", displayOrder: 1 },
];

beforeEach(() => {
  (window as any).api = {
    findSongsByTitle: vi.fn().mockResolvedValue(songs),
    getBlocksForSong: vi.fn().mockImplementation((songId: number) =>
      Promise.resolve(songId === 1 ? blocksForSong1 : [])
    ),
    createSong: vi.fn().mockResolvedValue({ id: 3, title: 'New Song', ccliNumber: null }),
    updateSong: vi.fn().mockResolvedValue(undefined),
    deleteSong: vi.fn().mockResolvedValue(undefined),
    addSongBlock: vi.fn().mockResolvedValue({ id: 12, songId: 1, label: 'Verse 2', text: '', displayOrder: 2 }),
    updateSongBlock: vi.fn().mockResolvedValue(undefined),
    deleteSongBlock: vi.fn().mockResolvedValue(undefined),
    reorderSongBlocks: vi.fn().mockResolvedValue(undefined),
  };
});

describe('SongLibraryPanel', () => {
  it('lists every song by title', async () => {
    render(<SongLibraryPanel />);
    expect(await screen.findByText('Amazing Grace')).toBeInTheDocument();
    expect(screen.getByText('How Great Thou Art')).toBeInTheDocument();
  });

  it('opens a song editor with its blocks when a song is clicked', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    expect(await screen.findByDisplayValue('Amazing grace, how sweet the sound')).toBeInTheDocument();
    expect(screen.getByDisplayValue("My chains are gone")).toBeInTheDocument();
  });

  it('creates a new song and opens it for editing', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /new song/i }));
    await waitFor(() => expect(window.api.createSong).toHaveBeenCalledWith('New Song', null));
    expect(await screen.findByDisplayValue('New Song')).toBeInTheDocument();
  });

  it('saves an edited song title on blur', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });
    fireEvent.blur(titleInput);
    await waitFor(() =>
      expect(window.api.updateSong).toHaveBeenCalledWith(1, 'Amazing Grace (Traditional)', '22025')
    );
  });

  it('adds a new block to the song', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.click(screen.getByRole('button', { name: /add verse/i }));
    await waitFor(() => expect(window.api.addSongBlock).toHaveBeenCalledWith(1, 'Verse 3', ''));
  });

  it('edits a block label and text on blur', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const textArea = await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.change(textArea, { target: { value: 'Updated first line' } });
    fireEvent.blur(textArea);
    await waitFor(() => expect(window.api.updateSongBlock).toHaveBeenCalledWith(10, 'Verse 1', 'Updated first line'));
  });

  it('relabels a block from verse to chorus', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const labelInput = await screen.findByDisplayValue('Verse 1');
    fireEvent.change(labelInput, { target: { value: 'Chorus 1' } });
    fireEvent.blur(labelInput);
    await waitFor(() =>
      expect(window.api.updateSongBlock).toHaveBeenCalledWith(10, 'Chorus 1', 'Amazing grace, how sweet the sound')
    );
  });

  it('deletes a block', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.click(screen.getAllByRole('button', { name: /delete block/i })[0]);
    await waitFor(() => expect(window.api.deleteSongBlock).toHaveBeenCalledWith(10));
  });

  it('moves a block down and calls reorderSongBlocks with the new order', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.click(screen.getAllByRole('button', { name: /move down/i })[0]);
    await waitFor(() => expect(window.api.reorderSongBlocks).toHaveBeenCalledWith(1, [11, 10]));
  });

  it('deletes the song after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    fireEvent.click(await screen.findByRole('button', { name: /delete song/i }));
    await waitFor(() => expect(window.api.deleteSong).toHaveBeenCalledWith(1));
  });

  it('does not delete the song when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    fireEvent.click(await screen.findByRole('button', { name: /delete song/i }));
    expect(window.api.deleteSong).not.toHaveBeenCalled();
  });
});
