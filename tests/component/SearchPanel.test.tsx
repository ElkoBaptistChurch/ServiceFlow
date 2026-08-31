import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchPanel from '../../src/renderer/components/SearchPanel';

// id 7 is ServiceFlow's own book id; 43 is the source id it came from. The component
// must always pass the former around.
const JOHN = { id: 7, translation: 'KJV', sourceBookId: 43, name: 'John', testament: 'NT', sortOrder: 43 };

beforeEach(() => {
  (window as any).api = {
    findBibleBooks: vi.fn().mockResolvedValue([JOHN]),
    getChaptersForBook: vi.fn().mockResolvedValue([1, 2, 3]),
    searchBibleContent: vi.fn().mockResolvedValue([]),
    findSongsByTitle: vi.fn().mockResolvedValue([{ id: 1, title: 'Amazing Grace', ccliNumber: null }]),
    searchSongContent: vi.fn().mockResolvedValue([]),
    stageItem: vi
      .fn()
      .mockResolvedValue({ id: 1, type: 'bible', refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' }),
  };
});

describe('SearchPanel', () => {
  it('searches bible books by typed name and stages a chapter on click', async () => {
    const onStaged = vi.fn();
    render(<SearchPanel translation="KJV" onStaged={onStaged} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'joh' } });
    await waitFor(() => expect(window.api.findBibleBooks).toHaveBeenCalledWith('joh', 'KJV'));

    fireEvent.click(await screen.findByText('John'));
    await waitFor(() => expect(window.api.getChaptersForBook).toHaveBeenCalledWith(7));
    fireEvent.click(await screen.findByText('3'));

    await waitFor(() => expect(window.api.stageItem).toHaveBeenCalledWith('bible', 7, 3));
    expect(onStaged).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), null);
  });

  it('searches the translation it is given, not a hardcoded one', async () => {
    render(<SearchPanel translation="New King James Version (NKJV)" onStaged={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'joh' } });
    await waitFor(() =>
      expect(window.api.findBibleBooks).toHaveBeenCalledWith('joh', 'New King James Version (NKJV)')
    );
  });

  it('switches to song mode and stages a song by title', async () => {
    (window.api.stageItem as any).mockResolvedValue({ id: 2, type: 'song', refId: 1, chapter: null, position: 0, label: 'Amazing Grace' });
    const onStaged = vi.fn();
    render(<SearchPanel translation="KJV" onStaged={onStaged} />);

    fireEvent.click(screen.getByRole('button', { name: /songs/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'amaz' } });
    await waitFor(() => expect(window.api.findSongsByTitle).toHaveBeenCalledWith('amaz'));

    fireEvent.click(await screen.findByText('Amazing Grace'));

    await waitFor(() => expect(window.api.stageItem).toHaveBeenCalledWith('song', 1, null));
    expect(onStaged).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), null);
  });

  // The spec requires a content-search hit to jump straight to the matched verse.
  it('reports the matched verse id so the content pane can jump to it', async () => {
    (window.api.searchBibleContent as any).mockResolvedValue([
      {
        verse: { id: 900, bookId: 7, chapter: 3, verse: 16, text: 'For God so loved the world.' },
        bookName: 'John',
        translation: 'KJV',
      },
    ]);
    const onStaged = vi.fn();
    render(<SearchPanel translation="KJV" onStaged={onStaged} />);

    fireEvent.click(screen.getByRole('button', { name: /content search/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'loved' } });

    fireEvent.click(await screen.findByText(/John 3:16/));

    await waitFor(() => expect(window.api.stageItem).toHaveBeenCalledWith('bible', 7, 3));
    expect(onStaged).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 900);
  });

  it('shows a "no matches" state when content search returns nothing', async () => {
    render(<SearchPanel translation="KJV" onStaged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /content search/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz' } });

    await waitFor(() => expect(window.api.searchBibleContent).toHaveBeenCalledWith('zzz', 'KJV'));
    expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
  });
});
