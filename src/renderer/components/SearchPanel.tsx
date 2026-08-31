import { useEffect, useRef, useState } from 'react';
import type { BibleBook, StagedItem } from '../../shared/types';

type Mode = 'bible' | 'song';
type SubMode = 'browse' | 'content';
// Live-as-you-type against 36k+ verses: wait for a pause before hitting FTS.
const SEARCH_DEBOUNCE_MS = 150;

interface Props {
  /** The active translation, owned by App. Never hardcode one here. */
  translation: string;
  /**
   * Called after an item is staged. `focusEntryId` is the verse/block the operator
   * matched in content search, so the content pane can jump straight to it; null when
   * they staged a whole chapter or song.
   */
  onStaged: (item: StagedItem, focusEntryId: number | null) => void;
}

export default function SearchPanel({ translation, onStaged }: Props) {
  const [mode, setMode] = useState<Mode>('bible');
  const [subMode, setSubMode] = useState<SubMode>('browse');
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [songs, setSongs] = useState<{ id: number; title: string }[]>([]);
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [chapters, setChapters] = useState<number[]>([]);
  const [contentResults, setContentResults] = useState<{ label: string; onSelect: () => void }[]>([]);
  // Monotonic sequence number so a slow, older query can never overwrite a newer one's
  // results if it resolves later: each search captures the id current at fire time and
  // only commits state if it is still the latest one issued by the time it resolves.
  const searchSeq = useRef(0);

  useEffect(() => {
    setSelectedBook(null);
    setChapters([]);
    setContentResults([]);
    if (query.trim() === '') {
      setBooks([]);
      setSongs([]);
      return;
    }
    const handle = setTimeout(() => {
      const requestId = ++searchSeq.current;
      const isStale = () => requestId !== searchSeq.current;
      if (subMode === 'browse' && mode === 'bible') {
        window.api.findBibleBooks(query, translation).then((results) => {
          if (isStale()) return;
          setBooks(results);
        });
      } else if (subMode === 'browse' && mode === 'song') {
        window.api.findSongsByTitle(query).then((results) => {
          if (isStale()) return;
          setSongs(results);
        });
      } else if (subMode === 'content' && mode === 'bible') {
        window.api.searchBibleContent(query, translation).then((results) => {
          if (isStale()) return;
          setContentResults(
            results.map((r) => ({
              label: `${r.bookName} ${r.verse.chapter}:${r.verse.verse} — ${r.verse.text}`,
              // Stage the chapter, then hand back the matched verse so the content pane
              // can scroll to and highlight it (staging alone is not "jump to the verse").
              onSelect: () =>
                window.api
                  .stageItem('bible', r.verse.bookId, r.verse.chapter)
                  .then((item) => onStaged(item, r.verse.id)),
            }))
          );
        });
      } else {
        window.api.searchSongContent(query).then((results) => {
          if (isStale()) return;
          setContentResults(
            results.map((r) => ({
              label: `${r.songTitle} (${r.block.label}) — ${r.block.text}`,
              onSelect: () =>
                window.api.stageItem('song', r.block.songId, null).then((item) => onStaged(item, r.block.id)),
            }))
          );
        });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, mode, subMode, translation]);

  async function selectBook(book: BibleBook) {
    setSelectedBook(book);
    setChapters(await window.api.getChaptersForBook(book.id));
  }

  return (
    <div>
      <div>
        <button onClick={() => { setMode('bible'); setQuery(''); }} aria-pressed={mode === 'bible'}>
          Bible
        </button>
        <button onClick={() => { setMode('song'); setQuery(''); }} aria-pressed={mode === 'song'}>
          Songs
        </button>
      </div>
      <div>
        <button onClick={() => { setSubMode('browse'); setQuery(''); }} aria-pressed={subMode === 'browse'}>
          Browse
        </button>
        <button onClick={() => { setSubMode('content'); setQuery(''); }} aria-pressed={subMode === 'content'}>
          Content search
        </button>
      </div>
      <input
        id="search-input"
        placeholder={mode === 'bible' ? 'Search book name or content...' : 'Search song title or lyrics...'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {subMode === 'browse' && mode === 'bible' && !selectedBook && (
        <ul>
          {books.length === 0 && query.trim() !== '' && <li>No matches</li>}
          {books.map((b) => (
            <li key={b.id}>
              <button onClick={() => selectBook(b)}>{b.name}</button>
            </li>
          ))}
        </ul>
      )}
      {subMode === 'browse' && mode === 'bible' && selectedBook && (
        <ul>
          {chapters.map((c) => (
            <li key={c}>
              <button onClick={() => window.api.stageItem('bible', selectedBook.id, c).then((item) => onStaged(item, null))}>
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
      {subMode === 'browse' && mode === 'song' && (
        <ul>
          {songs.length === 0 && query.trim() !== '' && <li>No matches</li>}
          {songs.map((s) => (
            <li key={s.id}>
              <button onClick={() => window.api.stageItem('song', s.id, null).then((item) => onStaged(item, null))}>
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {subMode === 'content' && (
        <ul>
          {contentResults.length === 0 && query.trim() !== '' && <li>No matches</li>}
          {contentResults.map((r, i) => (
            <li key={i}>
              <button onClick={r.onSelect}>{r.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
