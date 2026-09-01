import { useCallback, useEffect, useRef, useState } from 'react';
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
    return window.api.getStagedItems().then((loaded) => {
      setItems(loaded);
      return loaded;
    });
  }, []);

  // Runs once, on mount only: reselects the item that was live before a crash so the
  // content pane and arrow keys work immediately, without re-fighting the operator's own
  // later selections every time liveState or items happens to change again.
  const didInitActiveItem = useRef(false);

  useEffect(() => {
    Promise.all([refreshStagedItems(), window.api.getLiveState()]).then(([loadedItems, state]) => {
      setLiveStateValue(state);
      if (!didInitActiveItem.current) {
        didInitActiveItem.current = true;
        if (state.stagedItemId != null) {
          const restored = loadedItems.find((i) => i.id === state.stagedItemId);
          if (restored) setActiveItem(restored);
        }
      }
    });
    window.api.getActiveTranslation().then((t) => setTranslation(t ?? ''));
    const unsubscribe = window.api.onLiveStateChanged(setLiveStateValue);
    return unsubscribe;
  }, [refreshStagedItems]);

  // Removing the active item from the staged list (or any other refresh that drops it)
  // must not leave a ghost behind: a content pane still rendering a deleted item's verses
  // whose click either does nothing or, worse, blanks the live output because
  // buildOutputPayload finds no staged_items row for the id it carries.
  useEffect(() => {
    if (activeItem && !items.some((item) => item.id === activeItem.id)) {
      setActiveItem(null);
      setFocusEntryId(null);
    }
  }, [items, activeItem]);

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

  async function handleStaged(item: StagedItem, entryId: number | null) {
    // Await the refresh before selecting: the ghost-cleanup effect below reads `items` in
    // the same render pass, and if `items` is still the pre-stage list it wrongly concludes
    // this item was removed and deselects it out from under the operator (R-01).
    await refreshStagedItems();
    setActiveItem(item);
    setFocusEntryId(entryId); // content search jumps to the matched verse/block
  }

  function selectActive(item: StagedItem) {
    setActiveItem(item);
    setFocusEntryId(null);
  }

  const clearFocusEntry = useCallback(() => setFocusEntryId(null), []);

  // The IPC round-trip for setOutputHidden takes real time; a second Esc pressed before the
  // first response lands would otherwise read the same stale `liveState.hidden` closure and
  // send the SAME value twice (blank, blank) instead of alternating (blank, restore),
  // leaving the output stuck hidden. Track the freshest intended value in a ref, flipped
  // optimistically at call time, so a rapid second press always sees what the first just sent.
  const hiddenRef = useRef(liveState.hidden);
  useEffect(() => {
    hiddenRef.current = liveState.hidden;
  }, [liveState.hidden]);

  const toggleHidden = useCallback(() => {
    const next = !hiddenRef.current;
    hiddenRef.current = next;
    window.api.setOutputHidden(next).then(setLiveStateValue);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Autorepeat from a held key must not multiply a one-shot toggle or jump — a held
      // Escape sent 5 setOutputHidden calls from a single press before this guard existed.
      if (e.repeat) return;

      const target = e.target as HTMLElement | null;
      // No global shortcut may fire while a text field (or a <select>, which is close
      // enough from the operator's point of view — its own Escape/dropdown-dismiss must
      // not also blank the live output) has focus.
      const isTypingInField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;
      if (isTypingInField) return;

      const noModifier = !e.ctrlKey && !e.altKey && !e.metaKey;

      // Ctrl+F is deliberately a modifier shortcut; plain "/" is not, so Ctrl+/ must not
      // steal focus from whatever the operator actually meant that combo to do.
      if ((e.key === '/' && noModifier) || (e.key.toLowerCase() === 'f' && e.ctrlKey)) {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        toggleHidden();
        return;
      }

      if (noModifier && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1;
        if (items[index]) {
          setView('operate');
          selectActive(items[index]);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, toggleHidden]);

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
        <button aria-pressed={liveState.hidden} onClick={toggleHidden}>
          {liveState.hidden ? 'Show output' : 'Hide output'}
        </button>
      </nav>
      <LiveBanner liveState={liveState} />
      {view === 'settings' ? (
        <SettingsScreen onTranslationChange={setTranslation} />
      ) : (
        <div>
          <SearchPanel translation={translation} onStaged={handleStaged} />
          <StagedList
            items={items}
            activeItemId={activeItem?.id ?? null}
            liveStagedItemId={liveState.stagedItemId}
            onSelectActive={selectActive}
            onChanged={refreshStagedItems}
          />
          <ContentPane
            activeItem={activeItem}
            liveState={liveState}
            focusEntryId={focusEntryId}
            onFocusHandled={clearFocusEntry}
            onLive={() => window.api.getLiveState().then(setLiveStateValue)}
          />
        </div>
      )}
    </div>
  );
}
