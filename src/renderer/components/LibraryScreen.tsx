import { useCallback, useRef, useState } from 'react';
import SongLibraryPanel from './SongLibraryPanel';
import BibleLibraryPanel from './BibleLibraryPanel';

// The type list is built to grow (e.g. announcements, sermon outlines) without
// restructuring this screen — a new panel is another entry here. Each panel owns its own
// import entry point, next to the content it adds (D12).
const CONTENT_TYPES = [
  { key: 'songs', label: 'Songs' },
  { key: 'bibles', label: 'Bibles' },
] as const;
type ContentTypeKey = (typeof CONTENT_TYPES)[number]['key'];

const passThrough = (proceed: () => void) => proceed();

export default function LibraryScreen({
  registerDirtyGuard,
  onContentChanged,
}: {
  registerDirtyGuard?: (guard: (proceed: () => void) => void) => void;
  /** After an import, delete or restore: App refreshes the active translation, staged list and live state. */
  onContentChanged?: () => void;
}) {
  const [contentType, setContentType] = useState<ContentTypeKey>('songs');

  // The song editor registers a dirty guard so leaving it with unsaved changes goes
  // through its discard dialog — when switching tab here as well as when App switches view.
  const guardRef = useRef<(proceed: () => void) => void>(passThrough);
  const registerGuard = useCallback(
    (guard: (proceed: () => void) => void) => {
      guardRef.current = guard;
      registerDirtyGuard?.(guard);
    },
    [registerDirtyGuard]
  );

  function chooseType(next: ContentTypeKey) {
    if (next === contentType) return;
    guardRef.current(() => {
      // The song editor is about to unmount; its guard must not outlive it.
      guardRef.current = passThrough;
      registerDirtyGuard?.(passThrough);
      setContentType(next);
    });
  }

  return (
    <div className="library-page">
      <nav className="library-page__types">
        {CONTENT_TYPES.map((type) => (
          <button
            key={type.key}
            type="button"
            className="library-page__type"
            aria-pressed={contentType === type.key}
            onClick={() => chooseType(type.key)}
          >
            {type.label}
          </button>
        ))}
      </nav>
      <div className="library-page__panel">
        {contentType === 'songs' && (
          <SongLibraryPanel registerDirtyGuard={registerGuard} onContentChanged={onContentChanged} />
        )}
        {contentType === 'bibles' && <BibleLibraryPanel onContentChanged={onContentChanged} />}
      </div>
    </div>
  );
}
