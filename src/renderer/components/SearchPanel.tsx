import { useEffect, useRef, useState } from 'react';
import type { BibleBook, StagedItem } from '../../shared/types';

type Mode = 'bible' | 'song';
type SubMode = 'browse' | 'content';
// Live-as-you-type against 36k+ verses: wait for a pause before hitting FTS.
const SEARCH_DEBOUNCE_MS = 150;

interface ContentResult {
  ref: string;
  snippet: string;
  onSelect: () => void;
}

interface Props {
  /** The active translation, owned by App. Never hardcode one here. */
  translation: string;
  /**
   * Called after an item is staged. `focusEntryId` is the verse/block the operator
   * matched in content search, so the content pane can jump straight to it; null when
   * they staged a whole chapter or song.
   */
  onStaged: (item: StagedItem, focusEntryId: number | null) => void;
  /**
   * Results render as a popover over the staged list rather than a stacked panel, so App
   * needs to know when it is open to dim the list behind it. Optional so a standalone
   * render (tests) doesn't need to supply it.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Hands App a callback that clears the query, so a global Escape can close this popover
   * even when focus has moved onto one of the popover's own buttons (App's own listener
   * only exempts INPUT/TEXTAREA/SELECT, not these).
   */
  registerClose?: (close: () => void) => void;
}

export default function SearchPanel({ translation, onStaged, onOpenChange, registerClose }: Props) {
  const [mode, setMode] = useState<Mode>('bible');
  const [subMode, setSubMode] = useState<SubMode>('browse');
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [songs, setSongs] = useState<{ id: number; title: string }[]>([]);
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [chapters, setChapters] = useState<number[]>([]);
  const [contentResults, setContentResults] = useState<ContentResult[]>([]);
  // Which result the keyboard (arrow keys / Enter) currently targets in whichever list is
  // showing. Reset to the top whenever the visible list changes underneath it.
  const [highlighted, setHighlighted] = useState(0);
  // True while a search is in flight, so the "No matches" line can be shown only once a
  // search has actually finished with nothing -- otherwise it flashes during every
  // debounce + IPC round trip before the real results replace it.
  const [searching, setSearching] = useState(false);
  // Monotonic sequence number so a slow, older query can never overwrite a newer one's
  // results if it resolves later: each search captures the id current at fire time and
  // only commits state if it is still the latest one issued by the time it resolves.
  const searchSeq = useRef(0);

  const isOpen = query.trim() !== '';

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    registerClose?.(() => setQuery(''));
  }, [registerClose]);

  useEffect(() => {
    setSelectedBook(null);
    setChapters([]);
    setContentResults([]);
    setBooks([]);
    setSongs([]);
    if (query.trim() === '') {
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      const requestId = ++searchSeq.current;
      const isStale = () => requestId !== searchSeq.current;
      if (subMode === 'browse' && mode === 'bible') {
        window.api.findBibleBooks(query, translation).then((results) => {
          if (isStale()) return;
          setBooks(results);
          setSearching(false);
        });
      } else if (subMode === 'browse' && mode === 'song') {
        window.api.findSongsByTitle(query).then((results) => {
          if (isStale()) return;
          setSongs(results);
          setSearching(false);
        });
      } else if (subMode === 'content' && mode === 'bible') {
        window.api.searchBibleContent(query, translation).then((results) => {
          if (isStale()) return;
          setContentResults(
            results.map((r) => ({
              ref: `${r.bookName} ${r.verse.chapter}:${r.verse.verse}`,
              snippet: r.verse.text,
              // Stage the chapter, then hand back the matched verse so the content pane
              // can scroll to and highlight it (staging alone is not "jump to the verse").
              onSelect: () =>
                window.api
                  .stageItem('bible', r.verse.bookId, r.verse.chapter)
                  .then((item) => {
                    onStaged(item, r.verse.id);
                    setQuery('');
                  }),
            }))
          );
          setSearching(false);
        });
      } else {
        window.api.searchSongContent(query).then((results) => {
          if (isStale()) return;
          setContentResults(
            results.map((r) => ({
              ref: `${r.songTitle} (${r.block.label})`,
              snippet: r.block.text,
              onSelect: () =>
                window.api.stageItem('song', r.block.songId, null).then((item) => {
                  onStaged(item, r.block.id);
                  setQuery('');
                }),
            }))
          );
          setSearching(false);
        });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, mode, subMode, translation]);

  // Same monotonic-sequence idiom as the search effect above, applied to the one other
  // async path in this file: a slow chapter fetch for a book the operator has already
  // clicked past must not overwrite the chapters of the book now selected.
  const bookSeq = useRef(0);

  async function selectBook(book: BibleBook) {
    setSelectedBook(book);
    const requestId = ++bookSeq.current;
    const chaptersForBook = await window.api.getChaptersForBook(book.id);
    if (requestId !== bookSeq.current) return;
    setChapters(chaptersForBook);
  }

  // A single flat list of whatever is currently on screen, so Enter/arrow keys can
  // operate the same way regardless of which of the four views (books, chapters, songs,
  // content matches) is showing.
  const activeResults: { key: string | number; onSelect: () => void }[] =
    subMode === 'content'
      ? contentResults.map((r, i) => ({ key: i, onSelect: r.onSelect }))
      : mode === 'bible' && selectedBook
        ? chapters.map((c) => ({
            key: c,
            onSelect: () =>
              window.api.stageItem('bible', selectedBook.id, c).then((item) => {
                onStaged(item, null);
                setQuery('');
              }),
          }))
        : mode === 'bible'
          ? books.map((b) => ({ key: b.id, onSelect: () => selectBook(b) }))
          : songs.map((s) => ({
              key: s.id,
              onSelect: () =>
                window.api.stageItem('song', s.id, null).then((item) => {
                  onStaged(item, null);
                  setQuery('');
                }),
            }));

  useEffect(() => {
    setHighlighted(0);
  }, [books, songs, chapters, contentResults, selectedBook]);

  const safeHighlighted = Math.min(highlighted, Math.max(activeResults.length - 1, 0));

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && isOpen) {
      // Closes the popover without displacing or altering the staged list underneath it.
      e.preventDefault();
      setQuery('');
      return;
    }
    if (!isOpen || activeResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, activeResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activeResults[safeHighlighted]?.onSelect();
    }
  }

  const matchWord = activeResults.length === 1 ? 'match' : 'matches';

  return (
    <div className="search-anchor">
      <div className="search-box">
        <svg
          className="search-box__icon"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          id="search-input"
          className="search-box__input"
          placeholder={mode === 'bible' ? 'Search book name or content...' : 'Search song title or lyrics...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        {isOpen ? (
          <span className="search-box__count">
            {activeResults.length} {matchWord}
          </span>
        ) : (
          <span className="search-box__hint">/</span>
        )}
      </div>

      <div className="mode-tabs">
        <button
          className={`pill ${mode === 'bible' ? 'pill--active' : ''}`}
          onClick={() => {
            setMode('bible');
            setQuery('');
          }}
          aria-pressed={mode === 'bible'}
        >
          Bible
        </button>
        <button
          className={`pill ${mode === 'song' ? 'pill--active' : ''}`}
          onClick={() => {
            setMode('song');
            setQuery('');
          }}
          aria-pressed={mode === 'song'}
        >
          Songs
        </button>
      </div>
      <div className="submode-tabs">
        <button
          className={`pill pill--ghost ${subMode === 'browse' ? 'pill--active' : ''}`}
          onClick={() => {
            setSubMode('browse');
            setQuery('');
          }}
          aria-pressed={subMode === 'browse'}
        >
          Browse
        </button>
        <button
          className={`pill pill--ghost ${subMode === 'content' ? 'pill--active' : ''}`}
          onClick={() => {
            setSubMode('content');
            setQuery('');
          }}
          aria-pressed={subMode === 'content'}
        >
          Content search
        </button>
      </div>

      {isOpen && (
        <div className="search-popover" role="listbox" aria-label="Search results">
          {subMode === 'browse' && mode === 'bible' && !selectedBook && (
            <>
              <div className="search-popover__section">
                <span className="search-popover__section-label">Books</span>
              </div>
              {books.length === 0 && !searching && <div className="search-popover__empty">No matches</div>}
              <ul className="search-popover__list">
                {books.map((b, i) => (
                  <li key={b.id}>
                    <button
                      className={`search-popover__row-btn ${i === safeHighlighted ? 'search-popover__row-btn--active' : ''}`}
                      onClick={() => selectBook(b)}
                    >
                      <span className="search-popover__row-title">{b.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {subMode === 'browse' && mode === 'bible' && selectedBook && (
            <>
              <div className="search-popover__section">
                <span className="search-popover__section-label">Books</span>
                <button
                  type="button"
                  className="search-popover__back"
                  onClick={() => {
                    setSelectedBook(null);
                    setChapters([]);
                  }}
                >
                  &larr; Back to books
                </button>
              </div>
              <div className="search-popover__book">
                <span className="search-popover__book-title">{selectedBook.name}</span>
                <span className="search-popover__book-count">
                  {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="chapter-grid">
                {chapters.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    className={`chapter-cell ${i === safeHighlighted ? 'chapter-cell--active' : ''}`}
                    onClick={() =>
                      window.api.stageItem('bible', selectedBook.id, c).then((item) => {
                        onStaged(item, null);
                        setQuery('');
                      })
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}

          {subMode === 'browse' && mode === 'song' && (
            <>
              <div className="search-popover__section">
                <span className="search-popover__section-label">Songs</span>
              </div>
              {songs.length === 0 && !searching && <div className="search-popover__empty">No matches</div>}
              <ul className="search-popover__list">
                {songs.map((s, i) => (
                  <li key={s.id}>
                    <button
                      className={`search-popover__row-btn ${i === safeHighlighted ? 'search-popover__row-btn--active' : ''}`}
                      onClick={() =>
                        window.api.stageItem('song', s.id, null).then((item) => {
                          onStaged(item, null);
                          setQuery('');
                        })
                      }
                    >
                      <span className="search-popover__row-title">{s.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {subMode === 'content' && (
            <>
              <div className="search-popover__section">
                <span className="search-popover__section-label">In the words</span>
              </div>
              {contentResults.length === 0 && !searching && <div className="search-popover__empty">No matches</div>}
              <ul className="search-popover__list">
                {contentResults.map((r, i) => (
                  <li key={i}>
                    <button
                      className={`search-result-row ${i === safeHighlighted ? 'search-result-row--active' : ''}`}
                      onClick={r.onSelect}
                    >
                      <span className="search-result-row__ref">{r.ref}</span>
                      <span className="search-result-row__snippet">{r.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="search-popover__footer">
            <span>
              <strong>Enter</strong> adds it to today
            </span>
            <span>
              <strong>Esc</strong> closes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
