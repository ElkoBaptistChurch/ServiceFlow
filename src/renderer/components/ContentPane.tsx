import { useEffect, useRef, useState } from 'react';
import type { BibleVerse, LiveState, SongBlock, StagedItem } from '../../shared/types';

interface Props {
  activeItem: StagedItem | null;
  liveState: LiveState;
  /** Verse/block a content search matched: scroll to and highlight it, do NOT go live. */
  focusEntryId: number | null;
  onLive: () => void;
}

export default function ContentPane({ activeItem, liveState, focusEntryId, onLive }: Props) {
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [blocks, setBlocks] = useState<SongBlock[]>([]);
  const paneRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!activeItem) {
      setVerses([]);
      setBlocks([]);
      return;
    }
    // refId is a bible_books.id, so the translation is already baked in.
    if (activeItem.type === 'bible' && activeItem.chapter != null) {
      window.api.getVersesForChapter(activeItem.refId, activeItem.chapter).then(setVerses);
      setBlocks([]);
    } else if (activeItem.type === 'song') {
      window.api.getBlocksForSong(activeItem.refId).then(setBlocks);
      setVerses([]);
    }
  }, [activeItem]);

  useEffect(() => {
    if (focusEntryId == null) return;
    paneRef.current
      ?.querySelector(`[data-entry-id="${focusEntryId}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [focusEntryId, verses, blocks]);

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
    if (!activeItem || liveState.stagedItemId !== activeItem.id || liveState.verseOrBlockId == null) return;
    const list = activeItem.type === 'bible' ? verses : blocks;
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
    <ul ref={paneRef} role="list" aria-label="Content" tabIndex={0} onKeyDown={onKeyDown}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            data-entry-id={entry.id}
            data-matched={focusEntryId === entry.id ? 'true' : undefined}
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
  );
}
