import { useEffect, useState } from 'react';
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

function toEditable(block: SongBlock): EditableBlock {
  return { ...block, key: `db-${block.id}` };
}

function reorder<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const reordered = items.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

export default function SongLibraryPanel({
  registerDirtyGuard,
}: {
  registerDirtyGuard?: (guard: () => boolean) => void;
}) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const refreshSongs = () => window.api.findSongsByTitle(searchQuery).then(setSongs);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.api.findSongsByTitle(searchQuery).then(setSongs);
    }, 150);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  function confirmDiscard(title: string): boolean {
    if (!dirty) return true;
    return window.confirm(`You have unsaved changes to "${title}". Discard them and switch songs?`);
  }

  useEffect(() => {
    if (!registerDirtyGuard) return;
    registerDirtyGuard(() => {
      if (!dirty || !selectedSong) return true;
      return confirmDiscard(selectedSong.title);
    });
  }, [registerDirtyGuard, dirty, selectedSong]);

  function openSong(song: Song) {
    if (selectedSong && !confirmDiscard(selectedSong.title)) return;
    setSelectedSong(song);
    window.api.getBlocksForSong(song.id).then((loaded) => {
      const editable = loaded.map(toEditable);
      setBlocks(editable);
      setSnapshot({ song, blocks: editable });
      setDirty(false);
    });
  }

  async function createNewSong() {
    if (selectedSong && !confirmDiscard(selectedSong.title)) return;
    const song = await window.api.createSong('New Song', null);
    await refreshSongs();
    setSelectedSong(song);
    setBlocks([]);
    setSnapshot({ song, blocks: [] });
    setDirty(false);
  }

  async function deleteSelectedSong() {
    if (!selectedSong) return;
    if (!window.confirm(`Delete "${selectedSong.title}"? This cannot be undone.`)) return;
    await window.api.deleteSong(selectedSong.id);
    setSelectedSong(null);
    setBlocks([]);
    setSnapshot(null);
    setDirty(false);
    refreshSongs();
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
        label: `Verse ${current.length + 1}`,
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

    if (selectedSong.title !== snapshot.song.title || selectedSong.ccliNumber !== snapshot.song.ccliNumber) {
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
  }

  return (
    <div className="song-library">
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
  );
}
