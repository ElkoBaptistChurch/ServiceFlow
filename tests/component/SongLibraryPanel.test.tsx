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
    findSongsByQuery: vi.fn().mockResolvedValue(songs),
    getBlocksForSong: vi.fn().mockImplementation((songId: number) =>
      Promise.resolve(songId === 1 ? blocksForSong1 : [])
    ),
    findDuplicateSong: vi.fn().mockResolvedValue(null),
    createSong: vi.fn().mockResolvedValue({ id: 3, title: 'New Song', ccliNumber: null }),
    updateSong: vi.fn().mockResolvedValue(undefined),
    deleteSong: vi.fn().mockResolvedValue(undefined),
    addSongBlock: vi.fn().mockResolvedValue({ id: 12, songId: 1, label: 'Verse 2', text: '', displayOrder: 2 }),
    updateSongBlock: vi.fn().mockResolvedValue(undefined),
    deleteSongBlock: vi.fn().mockResolvedValue(undefined),
    reorderSongBlocks: vi.fn().mockResolvedValue(undefined),
  };
});

function clickSave() {
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
}

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

  it('the Save button starts disabled and enables once a field is edited', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  it('does not persist an edited title until Save is clicked', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });
    fireEvent.blur(titleInput);
    expect(window.api.updateSong).not.toHaveBeenCalled();

    clickSave();
    await waitFor(() =>
      expect(window.api.updateSong).toHaveBeenCalledWith(1, 'Amazing Grace (Traditional)', '22025')
    );
  });

  it('does not create a block until Save is clicked, then adds it with the pending label', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.click(screen.getByRole('button', { name: /add verse/i }));
    expect(window.api.addSongBlock).not.toHaveBeenCalled();

    clickSave();
    await waitFor(() => expect(window.api.addSongBlock).toHaveBeenCalledWith(1, 'Verse 2', ''));
  });

  it('numbers a new verse after the highest existing verse number, not the total block count', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.click(screen.getByRole('button', { name: /add verse/i }));
    fireEvent.click(screen.getByRole('button', { name: /add verse/i }));
    expect(screen.getByDisplayValue('Verse 2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Verse 3')).toBeInTheDocument();
  });

  it('does not persist an edited block until Save is clicked', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const textArea = await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.change(textArea, { target: { value: 'Updated first line' } });
    fireEvent.blur(textArea);
    expect(window.api.updateSongBlock).not.toHaveBeenCalled();

    clickSave();
    await waitFor(() => expect(window.api.updateSongBlock).toHaveBeenCalledWith(10, 'Verse 1', 'Updated first line'));
  });

  it('relabels a block from verse to chorus on Save', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const labelInput = await screen.findByDisplayValue('Verse 1');
    fireEvent.change(labelInput, { target: { value: 'Chorus 1' } });

    clickSave();
    await waitFor(() =>
      expect(window.api.updateSongBlock).toHaveBeenCalledWith(10, 'Chorus 1', 'Amazing grace, how sweet the sound')
    );
  });

  it('does not delete a block until Save is clicked', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.click(screen.getAllByRole('button', { name: /delete block/i })[0]);
    expect(window.api.deleteSongBlock).not.toHaveBeenCalled();

    clickSave();
    await waitFor(() => expect(window.api.deleteSongBlock).toHaveBeenCalledWith(10));
  });

  it('reorders blocks via drag and drop and persists the new order on Save', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    const rows = document.querySelectorAll('.song-block-row');
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[1]);
    fireEvent.drop(rows[1]);
    expect(window.api.reorderSongBlocks).not.toHaveBeenCalled();

    clickSave();
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

  it('warns before switching songs with unsaved changes, and stays put if declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });

    fireEvent.click(screen.getByText('How Great Thou Art'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByDisplayValue('Amazing Grace (Traditional)')).toBeInTheDocument();
  });

  it('discards unsaved changes and switches songs when the warning is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });

    fireEvent.click(screen.getByText('How Great Thou Art'));
    await waitFor(() => expect(window.api.getBlocksForSong).toHaveBeenCalledWith(2));
    expect(window.api.updateSong).not.toHaveBeenCalled();
  });

  it('does not warn when switching songs with no unsaved changes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');

    fireEvent.click(screen.getByText('How Great Thou Art'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('reports dirty state through the registered guard, and clears it after Save', async () => {
    let guard: (() => boolean) | undefined;
    render(<SongLibraryPanel registerDirtyGuard={(fn) => (guard = fn)} />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');

    expect(guard!()).toBe(true);

    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(guard!()).toBe(false);

    clickSave();
    await waitFor(() => expect(window.api.updateSong).toHaveBeenCalled());
    expect(guard!()).toBe(true);
  });

  it('shows an error and does not clear dirty state when a save fails', async () => {
    (window.api.updateSong as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database is locked'));
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });

    clickSave();
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  it('lets the error banner be dismissed', async () => {
    (window.api.getBlocksForSong as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Load failed'));
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks Save and shows an error when the title exactly matches another song', async () => {
    (window.api.findDuplicateSong as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 2,
      title: 'How Great Thou Art',
      ccliNumber: '14181',
    });
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'How Great Thou Art' } });

    clickSave();
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(window.api.updateSong).not.toHaveBeenCalled();
  });

  it('blocks Save and shows an error when the CCLI number matches another song', async () => {
    (window.api.findDuplicateSong as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 2,
      title: 'How Great Thou Art',
      ccliNumber: '14181',
    });
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const ccliInput = await screen.findByDisplayValue('22025');
    fireEvent.change(ccliInput, { target: { value: '14181' } });

    clickSave();
    expect(await screen.findByRole('alert')).toHaveTextContent(/already used by "How Great Thou Art"/i);
    expect(window.api.updateSong).not.toHaveBeenCalled();
  });

  it('does not check for duplicates when title and CCLI number are unchanged', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const textArea = await screen.findByDisplayValue('Amazing grace, how sweet the sound');
    fireEvent.change(textArea, { target: { value: 'Updated first line' } });

    clickSave();
    await waitFor(() => expect(window.api.updateSongBlock).toHaveBeenCalled());
    expect(window.api.findDuplicateSong).not.toHaveBeenCalled();
  });

  it('focuses and selects the title field when a new song is created', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /new song/i }));
    const titleInput = await screen.findByDisplayValue('New Song');
    expect(titleInput).toHaveFocus();
  });

  it('marks the open song in the list as having unsaved changes', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    expect(screen.queryByText('(unsaved changes)')).not.toBeInTheDocument();

    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });
    expect(screen.getByText('(unsaved changes)')).toBeInTheDocument();

    clickSave();
    await waitFor(() => expect(screen.queryByText('(unsaved changes)')).not.toBeInTheDocument());
  });

  it('saves with Ctrl+S when there are unsaved changes', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    const titleInput = await screen.findByDisplayValue('Amazing Grace');
    fireEvent.change(titleInput, { target: { value: 'Amazing Grace (Traditional)' } });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(window.api.updateSong).toHaveBeenCalledWith(1, 'Amazing Grace (Traditional)', '22025')
    );
  });

  it('does not save with Ctrl+S when there are no unsaved changes', async () => {
    render(<SongLibraryPanel />);
    fireEvent.click(await screen.findByText('Amazing Grace'));
    await screen.findByDisplayValue('Amazing grace, how sweet the sound');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(window.api.updateSong).not.toHaveBeenCalled();
  });
});
