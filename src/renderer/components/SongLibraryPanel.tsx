import { useEffect, useState } from 'react';
import type { Song, SongBlock } from '../../shared/types';

function autoSizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function reorder(blocks: SongBlock[], fromIndex: number, toIndex: number): SongBlock[] {
  const reordered = blocks.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

export default function SongLibraryPanel() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [blocks, setBlocks] = useState<SongBlock[]>([]);
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

  function openSong(song: Song) {
    setSelectedSong(song);
    window.api.getBlocksForSong(song.id).then(setBlocks);
  }

  async function createNewSong() {
    const song = await window.api.createSong('New Song', null);
    await refreshSongs();
    openSong(song);
  }

  async function saveSongMeta(title: string, ccliNumber: string | null) {
    if (!selectedSong) return;
    await window.api.updateSong(selectedSong.id, title, ccliNumber);
    setSelectedSong({ ...selectedSong, title, ccliNumber });
    refreshSongs();
  }

  async function deleteSelectedSong() {
    if (!selectedSong) return;
    if (!window.confirm(`Delete "${selectedSong.title}"? This cannot be undone.`)) return;
    await window.api.deleteSong(selectedSong.id);
    setSelectedSong(null);
    setBlocks([]);
    refreshSongs();
  }

  async function addVerse() {
    if (!selectedSong) return;
    const block = await window.api.addSongBlock(selectedSong.id, `Verse ${blocks.length + 1}`, '');
    setBlocks([...blocks, block]);
  }

  async function saveBlock(id: number, label: string, text: string) {
    await window.api.updateSongBlock(id, label, text);
    setBlocks((current) => current.map((b) => (b.id === id ? { ...b, label, text } : b)));
  }

  async function deleteBlock(id: number) {
    await window.api.deleteSongBlock(id);
    setBlocks((current) => current.filter((b) => b.id !== id));
  }

  async function handleBlockDrop(targetIndex: number) {
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (!selectedSong || fromIndex === null || fromIndex === targetIndex) return;
    const reordered = reorder(blocks, fromIndex, targetIndex);
    setBlocks(reordered);
    await window.api.reorderSongBlocks(
      selectedSong.id,
      reordered.map((b) => b.id)
    );
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
                defaultValue={selectedSong.title}
                key={`title-${selectedSong.id}`}
                onBlur={(e) => saveSongMeta(e.target.value, selectedSong.ccliNumber)}
              />
            </div>
            <div className="song-library__meta-field song-library__meta-field--ccli">
              <label className="field-label" htmlFor="song-ccli">
                CCLI number
              </label>
              <input
                id="song-ccli"
                className="field-select"
                defaultValue={selectedSong.ccliNumber ?? ''}
                key={`ccli-${selectedSong.id}`}
                onBlur={(e) => saveSongMeta(selectedSong.title, e.target.value || null)}
              />
            </div>
            <button
              type="button"
              className="btn-pill btn-pill--danger btn-pill--small"
              onClick={deleteSelectedSong}
            >
              Delete song
            </button>
          </div>
          <ul className="song-library__blocks">
            {blocks.map((block, index) => (
              <li
                key={block.id}
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
                  defaultValue={block.label}
                  onBlur={(e) => saveBlock(block.id, e.target.value, block.text)}
                />
                <textarea
                  className="song-block-row__text"
                  aria-label={`Block ${index + 1} text`}
                  defaultValue={block.text}
                  ref={autoSizeTextarea}
                  onInput={(e) => autoSizeTextarea(e.currentTarget)}
                  onBlur={(e) => saveBlock(block.id, block.label, e.target.value)}
                />
                <button
                  type="button"
                  className="btn-pill btn-pill--danger btn-pill--small"
                  aria-label="Delete block"
                  onClick={() => deleteBlock(block.id)}
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
