import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ContentPane from '../../src/renderer/components/ContentPane';

const bibleItem = { id: 1, type: 'bible' as const, refId: 7, chapter: 3, position: 0, label: 'John 3 (KJV)' };
const liveState = { stagedItemId: null, verseOrBlockId: null, styleId: null, hidden: false, updatedAt: '', reference: null };

beforeEach(() => {
  (window as any).api = {
    getVersesForChapter: vi.fn().mockResolvedValue([
      { id: 100, bookId: 7, chapter: 3, verse: 16, text: 'For God so loved the world.' },
      { id: 101, bookId: 7, chapter: 3, verse: 17, text: 'For God sent not his Son to condemn.' },
    ]),
    setLiveState: vi.fn().mockResolvedValue({}),
  };
});

function pane() {
  return screen.getByRole('list', { name: /content/i });
}

describe('ContentPane', () => {
  it('lists verses for the active bible item', async () => {
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);
    expect(await screen.findByText(/For God so loved the world/)).toBeInTheDocument();
    expect(await screen.findByText(/For God sent not his Son/)).toBeInTheDocument();
    expect(window.api.getVersesForChapter).toHaveBeenCalledWith(7, 3);
  });

  it('sets live state when a verse is clicked', async () => {
    const onLive = vi.fn();
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={onLive} />);
    fireEvent.click(await screen.findByText(/For God so loved the world/));
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 100, null));
    expect(onLive).toHaveBeenCalled();
  });

  it('moves live to the next verse on ArrowDown when the pane has focus', async () => {
    const liveOnFirst = { ...liveState, stagedItemId: 1, verseOrBlockId: 100, reference: 'John 3:16' };
    render(<ContentPane activeItem={bibleItem} liveState={liveOnFirst} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);
    await screen.findByText(/For God so loved the world/);
    fireEvent.keyDown(pane(), { key: 'ArrowDown' });
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 101, null));
  });

  // An arrow key pressed while the operator is typing in the search box must never
  // change what the congregation is looking at.
  it('ignores arrow keys pressed outside the content pane', async () => {
    const liveOnFirst = { ...liveState, stagedItemId: 1, verseOrBlockId: 100, reference: 'John 3:16' };
    render(<ContentPane activeItem={bibleItem} liveState={liveOnFirst} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);
    await screen.findByText(/For God so loved the world/);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(window.api.setLiveState).not.toHaveBeenCalled();
  });

  it('highlights the verse a content search matched without putting it live', async () => {
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={101} onFocusHandled={vi.fn()} onLive={vi.fn()} />);
    const match = await screen.findByText(/For God sent not his Son/);
    await waitFor(() => expect(match.closest('button')).toHaveAttribute('data-matched', 'true'));
    expect(window.api.setLiveState).not.toHaveBeenCalled();
  });

  // M5: switching the active item quickly must not let an older, slower fetch overwrite
  // a newer selection's content -- the same class of race SearchPanel already guards
  // against with a monotonic request sequence.
  it('ignores a stale content fetch that resolves after a newer selection', async () => {
    const otherBibleItem = { id: 3, type: 'bible' as const, refId: 8, chapter: 1, position: 0, label: 'Genesis 1' };
    let resolveStale: (value: unknown) => void = () => {};
    const stalePromise = new Promise((resolve) => {
      resolveStale = resolve;
    });
    (window.api.getVersesForChapter as any) = vi
      .fn()
      .mockImplementationOnce(() => stalePromise) // for the first (soon-to-be-old) selection
      .mockResolvedValueOnce([{ id: 300, bookId: 8, chapter: 1, verse: 1, text: 'In the beginning.' }]);

    const { rerender } = render(
      <ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />
    );
    rerender(<ContentPane activeItem={otherBibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);

    expect(await screen.findByText(/In the beginning/)).toBeInTheDocument();

    // The stale fetch for the ORIGINAL item resolves late; it must not overwrite what is
    // now displayed for the newer item. Resolve inside act() and flush a microtask so the
    // (buggy, pre-fix) overwrite would actually have landed before we assert its absence.
    await act(async () => {
      resolveStale([{ id: 100, bookId: 7, chapter: 3, verse: 16, text: 'For God so loved the world.' }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/In the beginning/)).toBeInTheDocument();
    expect(screen.queryByText(/For God so loved the world/)).not.toBeInTheDocument();
  });

  // R-06: arrow keys must work as soon as an item is active, not only after the operator
  // has already clicked a verse to make one live -- the spec promises mouse-free jumps.
  it('ArrowDown goes live with the first entry when nothing in the list is live', async () => {
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);
    await screen.findByText(/For God so loved the world/);
    fireEvent.keyDown(pane(), { key: 'ArrowDown' });
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 100, null));
  });

  // R-12: blanking is sticky by design (the spec says so), but the content pane itself
  // must still tell the operator their click did nothing visible on stream.
  it('shows that output is blanked when selecting a verse while hidden', async () => {
    const hiddenLive = { ...liveState, stagedItemId: 1, verseOrBlockId: 101, hidden: true, reference: 'John 3:17' };
    render(<ContentPane activeItem={bibleItem} liveState={hiddenLive} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);
    const match = await screen.findByText(/For God sent not his Son/);
    expect(match.closest('button')).toHaveAttribute('data-blanked', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/output is hidden/i);
  });

  // R-13a: a shape the fetch effect doesn't recognize (e.g. a bible item with no chapter)
  // must clear stale content, never leave the previous item's entries rendered-and-clickable
  // under the new activeItem.id.
  it('clears stale content when the active item matches neither fetch branch', async () => {
    const songItem = { id: 2, type: 'song' as const, refId: 1, chapter: null, position: 0, label: 'Amazing Grace' };
    (window.api as any).getBlocksForSong = vi
      .fn()
      .mockResolvedValue([{ id: 200, songId: 1, label: 'V1', text: 'Amazing grace', displayOrder: 0 }]);

    const { rerender } = render(
      <ContentPane activeItem={songItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />
    );
    await screen.findByText(/Amazing grace/);

    const bibleNoChapter = { id: 4, type: 'bible' as const, refId: 7, chapter: null, position: 0, label: 'Weird item' };
    rerender(<ContentPane activeItem={bibleNoChapter} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);

    expect(screen.queryByText(/Amazing grace/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  // R-13b: even a normal item switch has a round-trip window where the old item's
  // entries are still rendered under the new activeItem.id and clickable -- must clear
  // immediately, before the fetch resolves.
  it('clears content immediately when the active item changes', async () => {
    const otherBibleItem = { id: 3, type: 'bible' as const, refId: 8, chapter: 1, position: 0, label: 'Genesis 1' };
    let resolveNew: (value: unknown) => void = () => {};
    (window.api.getVersesForChapter as any) = vi
      .fn()
      .mockResolvedValueOnce([{ id: 100, bookId: 7, chapter: 3, verse: 16, text: 'For God so loved the world.' }])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          })
      );

    const { rerender } = render(
      <ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />
    );
    await screen.findByText(/For God so loved the world/);

    rerender(<ContentPane activeItem={otherBibleItem} liveState={liveState} focusEntryId={null} onFocusHandled={vi.fn()} onLive={vi.fn()} />);

    expect(screen.queryByText(/For God so loved the world/)).not.toBeInTheDocument();

    resolveNew([{ id: 300, bookId: 8, chapter: 1, verse: 1, text: 'In the beginning.' }]);
    expect(await screen.findByText(/In the beginning/)).toBeInTheDocument();
  });
});
