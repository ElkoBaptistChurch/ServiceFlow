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
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onLive={vi.fn()} />);
    expect(await screen.findByText(/For God so loved the world/)).toBeInTheDocument();
    expect(await screen.findByText(/For God sent not his Son/)).toBeInTheDocument();
    expect(window.api.getVersesForChapter).toHaveBeenCalledWith(7, 3);
  });

  it('sets live state when a verse is clicked', async () => {
    const onLive = vi.fn();
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onLive={onLive} />);
    fireEvent.click(await screen.findByText(/For God so loved the world/));
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 100, null));
    expect(onLive).toHaveBeenCalled();
  });

  it('moves live to the next verse on ArrowDown when the pane has focus', async () => {
    const liveOnFirst = { ...liveState, stagedItemId: 1, verseOrBlockId: 100, reference: 'John 3:16' };
    render(<ContentPane activeItem={bibleItem} liveState={liveOnFirst} focusEntryId={null} onLive={vi.fn()} />);
    await screen.findByText(/For God so loved the world/);
    fireEvent.keyDown(pane(), { key: 'ArrowDown' });
    await waitFor(() => expect(window.api.setLiveState).toHaveBeenCalledWith(1, 101, null));
  });

  // An arrow key pressed while the operator is typing in the search box must never
  // change what the congregation is looking at.
  it('ignores arrow keys pressed outside the content pane', async () => {
    const liveOnFirst = { ...liveState, stagedItemId: 1, verseOrBlockId: 100, reference: 'John 3:16' };
    render(<ContentPane activeItem={bibleItem} liveState={liveOnFirst} focusEntryId={null} onLive={vi.fn()} />);
    await screen.findByText(/For God so loved the world/);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(window.api.setLiveState).not.toHaveBeenCalled();
  });

  it('highlights the verse a content search matched without putting it live', async () => {
    render(<ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={101} onLive={vi.fn()} />);
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
      <ContentPane activeItem={bibleItem} liveState={liveState} focusEntryId={null} onLive={vi.fn()} />
    );
    rerender(<ContentPane activeItem={otherBibleItem} liveState={liveState} focusEntryId={null} onLive={vi.fn()} />);

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
});
