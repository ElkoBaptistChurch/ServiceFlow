import { useEffect, useRef, useState } from 'react';
import type { Song, SongBlock } from '../../shared/types';

function autoSizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// A block that may not exist in the DB yet: id is null until Save creates it. `key` is a
// stable client-side identity (React keys, drag/drop) that survives across that save.
type EditableBlock = Omit<SongBlock, 'id'> & { id: number | null; key: string };

type Snapshot = { song: Song; blocks: EditableBlock[] };

// Renders as an in-app dialog instead of window.confirm(): a native dialog leaves the
// renderer without keyboard focus afterward on Linux, so nothing types until an unrelated
// click resyncs it (see the discard-changes flow this replaced).
type ConfirmState = { message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void };

function toEditable(block: SongBlock): EditableBlock {
  return { ...block, key: `db-${block.id}` };
}

function reorder<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const reordered = items.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

// Numbers a new block after the highest existing number for that prefix (not the total block
// count), so adding a Verse after a Chorus doesn't skip a number — e.g. Verse 1, Chorus 1 ->
// next verse is "Verse 2", not "Verse 3".
function nextLabelNumber(blocks: EditableBlock[], prefix: string): number {
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  const highest = blocks.reduce((max, block) => {
    const match = block.label.match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return highest + 1;
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : GENERIC_ERROR;
}

export default function SongLibraryPanel({
  registerDirtyGuard,
}: {
  registerDirtyGuard?: (guard: (proceed: () => void) => void) => void;
}) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const focusTitleOnOpen = useRef(false);

  const refreshSongs = () =>
    window.api
      .findSongsByQuery(searchQuery)
      .then(setSongs)
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    const timeout = setTimeout(refreshSongs, 150);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (!focusTitleOnOpen.current) return;
    focusTitleOnOpen.current = false;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [selectedSong]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) saveChanges();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Runs `proceed` once the operator confirms discarding, or immediately if there's nothing
  // unsaved to discard. Always an in-app dialog, never window.confirm() (see ConfirmState).
  function requestDiscardConfirm(proceed: () => void) {
    if (!dirty || !selectedSong) {
      proceed();
      return;
    }
    setConfirmState({
      message: `You have unsaved changes to "${selectedSong.title}". Discard them and switch songs?`,
      confirmLabel: 'Discard',
      onConfirm: () => {
        setConfirmState(null);
        proceed();
      },
      onCancel: () => setConfirmState(null),
    });
  }

  useEffect(() => {
    if (!registerDirtyGuard) return;
    registerDirtyGuard(requestDiscardConfirm);
  }, [registerDirtyGuard, dirty, selectedSong]);

  function openSong(song: Song) {
    requestDiscardConfirm(async () => {
      setError(null);
      setSelectedSong(song);
      try {
        const loaded = await window.api.getBlocksForSong(song.id);
        const editable = loaded.map(toEditable);
        setBlocks(editable);
        setSnapshot({ song, blocks: editable });
        setDirty(false);
      } catch (err) {
        setError(errorMessage(err));
      }
    });
  }

  async function uniqueNewSongTitle(): Promise<string> {
    let n = 1;
    for (;;) {
      const candidate = n === 1 ? 'New Song' : `New Song ${n}`;
      const duplicate = await window.api.findDuplicateSong(candidate, null, -1);
      if (!duplicate) return candidate;
      n++;
    }
  }

  function createNewSong() {
    requestDiscardConfirm(async () => {
      setError(null);
      try {
        const title = await uniqueNewSongTitle();
        const song = await window.api.createSong(title, null);
        await refreshSongs();
        focusTitleOnOpen.current = true;
        setSelectedSong(song);
        setBlocks([]);
        setSnapshot({ song, blocks: [] });
        setDirty(false);
      } catch (err) {
        setError(errorMessage(err));
      }
    });
  }

  function deleteSelectedSong() {
    if (!selectedSong) return;
    const title = selectedSong.title;
    setConfirmState({
      message: `Delete "${title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmState(null);
        setError(null);
        try {
          await window.api.deleteSong(selectedSong.id);
          setSelectedSong(null);
          setBlocks([]);
          setSnapshot(null);
          setDirty(false);
          refreshSongs();
        } catch (err) {
          setError(errorMessage(err));
        }
      },
      onCancel: () => setConfirmState(null),
    });
  }

  function updateTitle(title: string) {
    if (!selectedSong) return;
    setSelectedSong({ ...selectedSong, title });
    setDirty(true);
  }

  function updateCcli(ccliNumber: string) {
    if (!selectedSong) return;
    setSelectedSong({ ...selectedSong, ccliNumber: ccliNumber || null });
    setDirty(true);
  }

  function addVerse() {
    setBlocks((current) => [
      ...current,
      {
        id: null,
        key: crypto.randomUUID(),
        songId: selectedSong?.id ?? 0,
        label: `Verse ${nextLabelNumber(current, 'Verse')}`,
        text: '',
        displayOrder: current.length,
      },
    ]);
    setDirty(true);
  }

  function updateBlockLabel(key: string, label: string) {
    setBlocks((current) => current.map((b) => (b.key === key ? { ...b, label } : b)));
    setDirty(true);
  }

  function updateBlockText(key: string, text: string) {
    setBlocks((current) => current.map((b) => (b.key === key ? { ...b, text } : b)));
    setDirty(true);
  }

  function deleteBlock(key: string) {
    setBlocks((current) => current.filter((b) => b.key !== key));
    setDirty(true);
  }

  function handleBlockDrop(targetIndex: number) {
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (fromIndex === null || fromIndex === targetIndex) return;
    setBlocks((current) => reorder(current, fromIndex, targetIndex));
    setDirty(true);
  }

  async function saveChanges() {
    if (!selectedSong || !snapshot) return;
    setError(null);

    const metaChanged =
      selectedSong.title !== snapshot.song.title || selectedSong.ccliNumber !== snapshot.song.ccliNumber;

    try {
      if (metaChanged) {
        const duplicate = await window.api.findDuplicateSong(
          selectedSong.title,
          selectedSong.ccliNumber,
          selectedSong.id
        );
        if (duplicate) {
          setError(
            duplicate.title.toLowerCase() === selectedSong.title.trim().toLowerCase()
              ? `A song titled "${duplicate.title}" already exists.`
              : `CCLI number ${selectedSong.ccliNumber} is already used by "${duplicate.title}".`
          );
          return;
        }
        await window.api.updateSong(selectedSong.id, selectedSong.title, selectedSong.ccliNumber);
      }

      const currentIds = new Set(blocks.filter((b) => b.id !== null).map((b) => b.id));
      for (const old of snapshot.blocks) {
        if (old.id !== null && !currentIds.has(old.id)) {
          await window.api.deleteSongBlock(old.id);
        }
      }

      const savedBlocks: EditableBlock[] = [];
      for (const block of blocks) {
        if (block.id === null) {
          const created = await window.api.addSongBlock(selectedSong.id, block.label, block.text);
          savedBlocks.push({ ...created, key: `db-${created.id}` });
        } else {
          const original = snapshot.blocks.find((b) => b.id === block.id);
          if (!original || original.label !== block.label || original.text !== block.text) {
            await window.api.updateSongBlock(block.id, block.label, block.text);
          }
          savedBlocks.push(block);
        }
      }

      await window.api.reorderSongBlocks(
        selectedSong.id,
        savedBlocks.map((b) => b.id as number)
      );

      setBlocks(savedBlocks);
      setSnapshot({ song: selectedSong, blocks: savedBlocks });
      setDirty(false);
      refreshSongs();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="song-library">
      {confirmState && (
        <div className="song-library__confirm-overlay" role="presentation" onClick={confirmState.onCancel}>
          <div
            className="song-library__confirm-box"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p>{confirmState.message}</p>
            <div className="song-library__confirm-actions">
              <button type="button" className="btn-pill btn-pill--small" onClick={confirmState.onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-pill btn-pill--danger btn-pill--small"
                onClick={confirmState.onConfirm}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="song-library__error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="song-library__error-dismiss"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="song-library__body">
        <div className="song-library__list">
          <button type="button" className="btn-pill" onClick={createNewSong}>
            + New Song
          </button>
          <input
            type="search"
            className="field-select song-library__search"
            placeholder="Search songs..."
            aria-label="Search songs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <ul className="song-library__songs">
            {songs.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  className="song-library__song-row"
                  aria-pressed={selectedSong?.id === song.id}
                  onClick={() => openSong(song)}
                >
                  {song.title}
                  {dirty && selectedSong?.id === song.id && (
                    <>
                      <span className="song-library__unsaved-dot" aria-hidden="true">
                        {' '}
                        •
                      </span>
                      <span className="sr-only"> (unsaved changes)</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selectedSong && (
          <div className="song-library__editor">
            <div className="song-library__meta">
              <div className="song-library__meta-field">
                <label className="field-label" htmlFor="song-title">
                  Title
                </label>
                <input
                  id="song-title"
                  ref={titleInputRef}
                  className="field-select"
                  value={selectedSong.title}
                  onChange={(e) => updateTitle(e.target.value)}
                />
              </div>
              <div className="song-library__meta-field song-library__meta-field--ccli">
                <label className="field-label" htmlFor="song-ccli">
                  CCLI number
                </label>
                <input
                  id="song-ccli"
                  className="field-select"
                  value={selectedSong.ccliNumber ?? ''}
                  onChange={(e) => updateCcli(e.target.value)}
                />
              </div>
              <div className="song-library__meta-actions">
                <button
                  type="button"
                  className="btn-pill btn-pill--danger btn-pill--small"
                  onClick={deleteSelectedSong}
                >
                  Delete song
                </button>
                <button
                  type="button"
                  className="btn-pill btn-pill--small song-library__save"
                  disabled={!dirty}
                  onClick={saveChanges}
                >
                  Save
                </button>
              </div>
            </div>
            <ul className="song-library__blocks">
              {blocks.map((block, index) => (
                <li
                  key={block.key}
                  className={[
                    'song-block-row',
                    dragOverIndex === index ? 'song-block-row--drag-over' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  onDragStart={() => setDraggedIndex(index)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(index);
                  }}
                  onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleBlockDrop(index);
                  }}
                  onDragEnd={() => {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                >
                  <span className="song-block-row__handle" aria-hidden="true">
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                      <circle cx="2" cy="2" r="1.5" />
                      <circle cx="8" cy="2" r="1.5" />
                      <circle cx="2" cy="8" r="1.5" />
                      <circle cx="8" cy="8" r="1.5" />
                      <circle cx="2" cy="14" r="1.5" />
                      <circle cx="8" cy="14" r="1.5" />
                    </svg>
                  </span>
                  <input
                    className="field-select song-block-row__label"
                    aria-label={`Block ${index + 1} label`}
                    value={block.label}
                    onChange={(e) => updateBlockLabel(block.key, e.target.value)}
                  />
                  <textarea
                    className="song-block-row__text"
                    aria-label={`Block ${index + 1} text`}
                    value={block.text}
                    ref={autoSizeTextarea}
                    onInput={(e) => autoSizeTextarea(e.currentTarget)}
                    onChange={(e) => updateBlockText(block.key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-pill btn-pill--danger btn-pill--small"
                    aria-label="Delete block"
                    onClick={() => deleteBlock(block.key)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-pill btn-pill--small song-library__add-verse" onClick={addVerse}>
              + Add verse
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
