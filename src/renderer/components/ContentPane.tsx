import { useEffect, useRef, useState } from 'react';
import type { BibleVerse, LiveState, SongBlock, StagedItem } from '../../shared/types';

interface Props {
  activeItem: StagedItem | null;
  liveState: LiveState;
  /** Verse/block a content search matched: scroll to and highlight it, do NOT go live. */
  focusEntryId: number | null;
  /** Called once the pane has scrolled to `focusEntryId`, so App can clear the one-shot value. */
  onFocusHandled: () => void;
  onLive: () => void;
}

export default function ContentPane({ activeItem, liveState, focusEntryId, onFocusHandled, onLive }: Props) {
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [blocks, setBlocks] = useState<SongBlock[]>([]);
  const paneRef = useRef<HTMLUListElement>(null);
  // Same class of bug SearchPanel guards against: switching activeItem quickly could let
  // an older, slower fetch for item A resolve after a newer one for item B and overwrite
  // its results. A monotonic sequence number ensures only the latest-issued fetch commits.
  const fetchSeq = useRef(0);

  useEffect(() => {
    const requestId = ++fetchSeq.current;
    const isStale = () => requestId !== fetchSeq.current;
    // Clear immediately, before the fetch resolves: otherwise the previous item's entries
    // stay rendered — and clickable, carrying the OLD staged-item id — for the whole
    // round-trip while activeItem.id already points at the new one (R-13).
    setVerses([]);
    setBlocks([]);
    if (!activeItem) return;
    // refId is a bible_books.id, so the translation is already baked in.
    if (activeItem.type === 'bible' && activeItem.chapter != null) {
      window.api.getVersesForChapter(activeItem.refId, activeItem.chapter).then((result) => {
        if (isStale()) return;
        setVerses(result);
        setBlocks([]);
      });
    } else if (activeItem.type === 'song') {
      window.api.getBlocksForSong(activeItem.refId).then((result) => {
        if (isStale()) return;
        setBlocks(result);
        setVerses([]);
      });
    }
    // An unhandled shape (e.g. a bible item with no chapter) must fail to empty, never to
    // stale-but-clickable content from the previous item.
  }, [activeItem]);

  useEffect(() => {
    if (focusEntryId == null) return;
    const target = paneRef.current?.querySelector(`[data-entry-id="${focusEntryId}"]`);
    if (!target) return; // content hasn't fetched yet; a later run of this effect will retry
    target.scrollIntoView({ block: 'center' });
    // One-shot: clear it once handled, so it doesn't re-trigger the scroll on every later
    // refetch, and so staging the SAME verse again is a fresh value that still fires (R-14).
    onFocusHandled();
  }, [focusEntryId, verses, blocks, onFocusHandled]);

  function goLive(id: number) {
    if (!activeItem) return;
    window.api.setLiveState(activeItem.id, id, null).then(onLive);
  }

  /**
   * Bound to the pane element, not to `window`. The spec requires arrow keys to steer
   * the output only when the content pane has focus — a global listener would let an
   * arrow key typed in the search box change what is on the stream.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (!activeItem) return;
    const list = activeItem.type === 'bible' ? verses : blocks;
    if (list.length === 0) return;

    const nothingLiveHere = liveState.stagedItemId !== activeItem.id || liveState.verseOrBlockId == null;
    if (nothingLiveHere) {
      // Cold start: either arrow key goes live with the first entry, so the keyboard-only
      // path the spec promises works without first reaching for the mouse (R-06).
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        goLive(list[0].id);
      }
      return;
    }

    const index = list.findIndex((entry) => entry.id === liveState.verseOrBlockId);
    if (index === -1) return;
    if (e.key === 'ArrowDown' && index < list.length - 1) {
      e.preventDefault();
      goLive(list[index + 1].id);
    }
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      goLive(list[index - 1].id);
    }
  }

  if (!activeItem) return <div>No item selected</div>;

  const isLiveId = (id: number) => liveState.stagedItemId === activeItem.id && liveState.verseOrBlockId === id;
  const entries =
    activeItem.type === 'bible'
      ? verses.map((v) => ({ id: v.id, text: `${v.verse}. ${v.text}` }))
      : blocks.map((b) => ({ id: b.id, text: `${b.label}: ${b.text}` }));

  return (
    <div>
      {/* LiveBanner already says this globally; the operator looking at THIS list, not the
          banner, needs the same fact right where they're clicking (R-12). Blanking stays
          sticky by design — this is feedback only, never an auto-unhide. */}
      {liveState.hidden && <p role="status">Output is hidden — the selection below will not appear until it's shown again.</p>}
      <ul ref={paneRef} role="list" aria-label="Content" tabIndex={0} onKeyDown={onKeyDown}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              data-entry-id={entry.id}
              data-matched={focusEntryId === entry.id ? 'true' : undefined}
              data-blanked={isLiveId(entry.id) && liveState.hidden ? 'true' : undefined}
              aria-pressed={isLiveId(entry.id)}
              onClick={(e) => {
                // Keep focus in the pane so the arrow keys work immediately afterwards.
                e.currentTarget.closest('ul')?.focus();
                goLive(entry.id);
              }}
            >
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
