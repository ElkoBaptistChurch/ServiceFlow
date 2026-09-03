import { useEffect, useState } from 'react';
import type { Song, SongBlock } from '../../shared/types';

export default function SongLibraryPanel() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [blocks, setBlocks] = useState<SongBlock[]>([]);

  const refreshSongs = () => window.api.findSongsByTitle('').then(setSongs);

  useEffect(() => {
    refreshSongs();
  }, []);

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

  async function moveBlock(index: number, direction: -1 | 1) {
    if (!selectedSong) return;
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const reordered = blocks.slice();
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
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
            <button type="button" className="btn-pill btn-pill--danger" onClick={deleteSelectedSong}>
              Delete song
            </button>
          </div>
          <ul className="song-library__blocks">
            {blocks.map((block, index) => (
              <li key={block.id} className="song-block-row">
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
                  onBlur={(e) => saveBlock(block.id, block.label, e.target.value)}
                />
                <div className="song-block-row__actions">
                  <button
                    type="button"
                    className="btn-pill"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => moveBlock(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-pill"
                    aria-label="Move down"
                    disabled={index === blocks.length - 1}
                    onClick={() => moveBlock(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn-pill btn-pill--danger"
                    aria-label="Delete block"
                    onClick={() => deleteBlock(block.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-pill" onClick={addVerse}>
            + Add verse
          </button>
        </div>
      )}
    </div>
  );
}
