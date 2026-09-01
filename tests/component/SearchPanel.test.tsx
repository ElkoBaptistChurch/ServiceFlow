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

  // Regression test: an older in-flight query resolving AFTER a newer one must not
  // clobber the newer results. Controls resolution order explicitly via deferred promises.
  it('keeps the newer book-search results when an older query resolves last', async () => {
    const ROMANS = { id: 45, translation: 'KJV', sourceBookId: 45, name: 'Romans', testament: 'NT', sortOrder: 45 };
    let resolveRom: (v: any) => void;
    let resolveRomans: (v: any) => void;
    const romPromise = new Promise((resolve) => { resolveRom = resolve; });
    const romansPromise = new Promise((resolve) => { resolveRomans = resolve; });

    (window.api.findBibleBooks as any).mockImplementation((q: string) => {
      if (q === 'rom') return romPromise;
      if (q === 'romans') return romansPromise;
      return Promise.resolve([]);
    });

    render(<SearchPanel translation="KJV" onStaged={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search/i);

    fireEvent.change(input, { target: { value: 'rom' } });
    await waitFor(() => expect(window.api.findBibleBooks).toHaveBeenCalledWith('rom', 'KJV'));

    fireEvent.change(input, { target: { value: 'romans' } });
    await waitFor(() => expect(window.api.findBibleBooks).toHaveBeenCalledWith('romans', 'KJV'));

    // Resolve the NEWER query first, then the OLDER (now-stale) one -- the older
    // response arriving last must not overwrite the newer, correct results.
    resolveRomans!([ROMANS]);
    await screen.findByText('Romans');
    resolveRom!([JOHN]);

    // Give any (incorrect) stale update a chance to land before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Romans')).toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
  });

  // Same class of bug on a content-search path.
  it('keeps the newer content-search results when an older query resolves last', async () => {
    let resolveOld: (v: any) => void;
    let resolveNew: (v: any) => void;
    const oldPromise = new Promise((resolve) => { resolveOld = resolve; });
    const newPromise = new Promise((resolve) => { resolveNew = resolve; });

    (window.api.searchBibleContent as any).mockImplementation((q: string) => {
      if (q === 'lov') return oldPromise;
      if (q === 'loved') return newPromise;
      return Promise.resolve([]);
    });

    render(<SearchPanel translation="KJV" onStaged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /content search/i }));
    const input = screen.getByPlaceholderText(/search/i);

    fireEvent.change(input, { target: { value: 'lov' } });
    await waitFor(() => expect(window.api.searchBibleContent).toHaveBeenCalledWith('lov', 'KJV'));

    fireEvent.change(input, { target: { value: 'loved' } });
    await waitFor(() => expect(window.api.searchBibleContent).toHaveBeenCalledWith('loved', 'KJV'));

    const newResult = {
      verse: { id: 900, bookId: 7, chapter: 3, verse: 16, text: 'For God so loved the world.' },
      bookName: 'John',
      translation: 'KJV',
    };
    const oldResult = {
      verse: { id: 901, bookId: 7, chapter: 3, verse: 19, text: 'men loved darkness rather than light.' },
      bookName: 'John',
      translation: 'KJV',
    };

    resolveNew!([newResult]);
    await screen.findByText(/John 3:16/);
    resolveOld!([oldResult]);

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/John 3:16/)).toBeInTheDocument();
    expect(screen.queryByText(/John 3:19/)).not.toBeInTheDocument();
  });

  // R-08: results from the previous query must not stay listed (and clickable) while a
  // newer query is in flight, and "No matches" must not flash before the new results land.
  it('does not show previous results under a new query', async () => {
    let resolveGen: (v: any) => void;
    const genPromise = new Promise((resolve) => { resolveGen = resolve; });
    (window.api.findBibleBooks as any).mockImplementation((q: string) => {
      if (q === 'gen') return genPromise;
      return new Promise(() => {}); // 'genxyz' never resolves in this test
    });

    render(<SearchPanel translation="KJV" onStaged={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search/i);

    fireEvent.change(input, { target: { value: 'gen' } });
    await waitFor(() => expect(window.api.findBibleBooks).toHaveBeenCalledWith('gen', 'KJV'));
    const GENESIS = { id: 1, translation: 'KJV', sourceBookId: 1, name: 'Genesis', testament: 'OT', sortOrder: 1 };
    resolveGen!([GENESIS]);
    await screen.findByText('Genesis');

    fireEvent.change(input, { target: { value: 'genxyz' } });
    await waitFor(() => expect(window.api.findBibleBooks).toHaveBeenCalledWith('genxyz', 'KJV'));

    expect(screen.queryByText('Genesis')).not.toBeInTheDocument();
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument();
  });

  // R-09: selectBook has no stale-response guard -- a slow chapter fetch for a book the
  // operator already clicked past must not overwrite the chapters of the book now selected.
  it('ignores a slow chapter fetch for a book that is no longer selected', async () => {
    const LAMENTATIONS = { id: 25, translation: 'KJV', sourceBookId: 25, name: 'Lamentations', testament: 'OT', sortOrder: 25 };
    const PSALMS = { id: 19, translation: 'KJV', sourceBookId: 19, name: 'Psalms', testament: 'OT', sortOrder: 19 };
    (window.api.findBibleBooks as any).mockResolvedValue([LAMENTATIONS, PSALMS]);

    let resolveLam: (v: any) => void;
    const lamPromise = new Promise((resolve) => { resolveLam = resolve; });
    (window.api.getChaptersForBook as any).mockImplementation((id: number) => {
      if (id === 25) return lamPromise;
      if (id === 19) return Promise.resolve([1, 2, 3]);
      return Promise.resolve([]);
    });

    render(<SearchPanel translation="KJV" onStaged={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'la' } });

    fireEvent.click(await screen.findByText('Lamentations'));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(await screen.findByText('Psalms'));
    await waitFor(() => expect(window.api.getChaptersForBook).toHaveBeenCalledWith(19));
    await screen.findByText('3');

    resolveLam!([150]);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('150')).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // R-10: once a book is picked there must be a way back to the book list.
  it('can return to the book list after selecting a book', async () => {
    render(<SearchPanel translation="KJV" onStaged={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'joh' } });
    fireEvent.click(await screen.findByText('John'));
    await screen.findByText('3');

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(await screen.findByText('John')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });
});
