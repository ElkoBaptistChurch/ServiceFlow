import { useCallback, useEffect, useState } from 'react';
import SearchPanel from './components/SearchPanel';
import StagedList from './components/StagedList';
import ContentPane from './components/ContentPane';
import LiveBanner from './components/LiveBanner';
import SettingsScreen from './components/SettingsScreen';
import type { LiveState, StagedItem } from '../shared/types';

const EMPTY_LIVE_STATE: LiveState = {
  stagedItemId: null,
  verseOrBlockId: null,
  styleId: null,
  hidden: false,
  updatedAt: '',
  reference: null,
};

export default function App() {
  const [view, setView] = useState<'operate' | 'settings'>('operate');
  const [items, setItems] = useState<StagedItem[]>([]);
  const [activeItem, setActiveItem] = useState<StagedItem | null>(null);
  const [focusEntryId, setFocusEntryId] = useState<number | null>(null);
  const [liveState, setLiveStateValue] = useState<LiveState>(EMPTY_LIVE_STATE);
  const [translation, setTranslation] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const refreshStagedItems = useCallback(() => {
    window.api.getStagedItems().then(setItems);
  }, []);

  useEffect(() => {
    refreshStagedItems();
    window.api.getLiveState().then(setLiveStateValue);
    window.api.getActiveTranslation().then((t) => setTranslation(t ?? ''));
    const unsubscribe = window.api.onLiveStateChanged(setLiveStateValue);
    return unsubscribe;
  }, [refreshStagedItems]);

  // Immediate persistence is this app's crash-recovery story, so a failed write must be
  // loud. Every window.api.* call is a promise; one listener turns any rejection into a
  // visible banner instead of a silent devtools error.
  useEffect(() => {
    function onRejection(e: PromiseRejectionEvent) {
      setError(String((e.reason as Error)?.message ?? e.reason));
      e.preventDefault();
    }
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  function handleStaged(item: StagedItem, entryId: number | null) {
    refreshStagedItems();
    setActiveItem(item);
    setFocusEntryId(entryId); // content search jumps to the matched verse/block
  }

  function selectActive(item: StagedItem) {
    setActiveItem(item);
    setFocusEntryId(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // No global shortcut may fire while a text field has focus — an operator typing a
      // search term must not be able to blank or switch the live output by accident.
      const isTypingInField =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
      if (isTypingInField) return;

      if (e.key === '/' || (e.key.toLowerCase() === 'f' && e.ctrlKey)) {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        window.api.setOutputHidden(!liveState.hidden).then(setLiveStateValue);
        return;
      }

      if (/^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1;
        if (items[index]) {
          setView('operate');
          selectActive(items[index]);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, liveState.hidden]);

  return (
    <div>
      {error && (
        <div role="alert" onClick={() => setError(null)}>
          ServiceFlow hit a problem: {error} (click to dismiss)
        </div>
      )}
      <nav>
        <button onClick={() => setView('operate')}>Operate</button>
        <button onClick={() => setView('settings')}>Settings</button>
        <button
          aria-pressed={liveState.hidden}
          onClick={() => window.api.setOutputHidden(!liveState.hidden).then(setLiveStateValue)}
        >
          {liveState.hidden ? 'Show output' : 'Hide output'}
        </button>
      </nav>
      <LiveBanner liveState={liveState} />
      {view === 'settings' ? (
        <SettingsScreen onTranslationChange={setTranslation} />
      ) : (
        <div>
          <SearchPanel translation={translation} onStaged={handleStaged} />
          <StagedList items={items} onSelectActive={selectActive} onChanged={refreshStagedItems} />
          <ContentPane
            activeItem={activeItem}
            liveState={liveState}
            focusEntryId={focusEntryId}
            onLive={() => window.api.getLiveState().then(setLiveStateValue)}
          />
        </div>
      )}
    </div>
  );
}
