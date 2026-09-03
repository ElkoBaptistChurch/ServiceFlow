import { useState } from 'react';
import SongLibraryPanel from './SongLibraryPanel';

// Only Songs today, but the type list is built to grow (e.g. announcements, sermon
// outlines) without restructuring this screen — a new panel is another entry here.
const CONTENT_TYPES = [{ key: 'songs', label: 'Songs' }] as const;
type ContentTypeKey = (typeof CONTENT_TYPES)[number]['key'];

export default function LibraryScreen() {
  const [contentType, setContentType] = useState<ContentTypeKey>('songs');

  return (
    <div className="library-page">
      <nav className="library-page__types">
        {CONTENT_TYPES.map((type) => (
          <button
            key={type.key}
            type="button"
            className="library-page__type"
            aria-pressed={contentType === type.key}
            onClick={() => setContentType(type.key)}
          >
            {type.label}
          </button>
        ))}
      </nav>
      <div className="library-page__panel">{contentType === 'songs' && <SongLibraryPanel />}</div>
    </div>
  );
}
