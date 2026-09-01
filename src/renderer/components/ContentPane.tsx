import { useEffect, useRef, useState } from 'react';
import type { BibleVerse, LiveState, SongBlock, StagedItem } from '../../shared/types';

interface Props {
  activeItem: StagedItem | null;
  liveState: LiveState;
  /** Verse/block a content search matched: scroll to and highlight it, do NOT go live. */
  focusEntryId: number | null;
  onLive: () => void;
  /** Shown next to the reference for bible items, e.g. "King James Version". Optional so
   * standalone renders (tests) don't need to supply it. */
  translation?: string;
}

export default function ContentPane({ activeItem, liveState, focusEntryId, onLive, translation }: Props) {
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
    if (!activeItem) {
      setVerses([]);
      setBlocks([]);
      return;
    }
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

  if (!activeItem) return <div className="content-pane__empty">No item selected</div>;

  const isLiveId = (id: number) => liveState.stagedItemId === activeItem.id && liveState.verseOrBlockId === id;
  const entries =
    activeItem.type === 'bible'
      ? verses.map((v) => ({ id: v.id, number: String(v.verse), text: v.text }))
      : blocks.map((b) => ({ id: b.id, number: b.label, text: b.text }));

  const liveIndex = entries.findIndex((entry) => isLiveId(entry.id));
  // Labels are formatted as "John 3 (KJV)"; when the translation is shown separately in
  // the header (below), strip the trailing "(KJV)" so it isn't printed twice.
  const title =
    activeItem.type === 'bible' && translation
      ? activeItem.label.replace(/\s*\([^)]*\)\s*$/, '')
      : activeItem.label;

  return (
    <div className="content-pane">
      <div className="content-pane__header">
        <span className="content-pane__title">{title}</span>
        {activeItem.type === 'bible' && translation && (
          <span className="content-pane__translation">{translation}</span>
        )}
        <div className="header-spacer" />
        <span className="content-pane__hint">Click a verse to put it on the stream</span>
      </div>
      <ul ref={paneRef} className="content-pane__body" role="list" aria-label="Content" tabIndex={0} onKeyDown={onKeyDown}>
        {entries.map((entry, index) => {
          const live = isLiveId(entry.id);
          const isNext = !live && liveIndex !== -1 && index === liveIndex + 1;
          const isFocused = focusEntryId === entry.id;
          const rowClass = [
            'entry-row',
            live ? 'entry-row--live' : '',
            isNext ? 'entry-row--next' : '',
            isFocused ? 'entry-row--focused' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={entry.id} className={rowClass}>
              <button
                className="entry-row__btn"
                data-entry-id={entry.id}
                data-matched={isFocused ? 'true' : undefined}
                aria-pressed={live}
                onClick={(e) => {
                  // Keep focus in the pane so the arrow keys work immediately afterwards.
                  e.currentTarget.closest('ul')?.focus();
                  goLive(entry.id);
                }}
              >
                <span className="entry-row__num">{entry.number}</span>
                {live ? (
                  <span className="entry-row__live-column">
                    <span className="entry-row__text">{entry.text}</span>
                    <span className="entry-row__live-label">
                      <span className="dot" />
                      On the stream now
                    </span>
                  </span>
                ) : (
                  <span className="entry-row__text">{entry.text}</span>
                )}
                {isNext && <span className="entry-row__next-label">Next</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="content-pane__footer">
        <span>
          <strong>Esc</strong> blanks the screen
        </span>
        <span>
          <strong>Up / Down</strong> moves a verse
        </span>
        <span>
          <strong>1–9, 0</strong> jumps between today&#8217;s items
        </span>
        <div className="content-pane__footer-spacer" />
        <span className="obs-status">
          <span className="dot" />
          OBS connected
        </span>
      </div>
    </div>
  );
}
