import { useCallback, useEffect, useRef, useState } from 'react';
import SearchPanel from './components/SearchPanel';
import StagedList from './components/StagedList';
import ContentPane from './components/ContentPane';
import LiveBanner from './components/LiveBanner';
import SettingsScreen from './components/SettingsScreen';
import type { LiveState, StagedItem, Theme } from '../shared/types';
import './styles/app.css';

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
  // Seeded from the value that came in with the window so the toggle renders in the right
  // position on the first frame; the getTheme() effect below stays as the authority.
  const [theme, setThemeState] = useState<Theme>(() => window.api?.initialTheme ?? 'light');
  // The staged list must never be displaced by results (IMPLEMENTATION.md); search
  // renders its results as a popover over the service list, so App only needs to know
  // whether that popover is open to dim the list behind it.
  const [searchOpen, setSearchOpen] = useState(false);

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

  // A dark-mode booth must not get a white flash: apply the persisted theme to the
  // document root as soon as it is known, same as every other setting here.
  useEffect(() => {
    window.api.getTheme().then((t) => {
      setThemeState(t);
      document.documentElement.setAttribute('data-theme', t);
    });
  }, []);

  const chooseTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    window.api.setTheme(next);
  }, []);

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

      if (noModifier && /^[0-9]$/.test(e.key)) {
        // The sidebar holds 10 items, badged 1-9 then 0 for the tenth.
        const index = e.key === '0' ? 9 : Number(e.key) - 1;
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
    <div className="app">
      {error && (
        <div role="alert" className="error-banner" onClick={() => setError(null)}>
          ServiceFlow hit a problem: {error} (click to dismiss)
        </div>
      )}
      <header className="app-header">
        <span className="app-header__logo">ServiceFlow</span>
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${view === 'operate' ? 'nav-tab--active' : ''}`}
            onClick={() => setView('operate')}
          >
            Operate
          </button>
          <button
            className={`nav-tab ${view === 'settings' ? 'nav-tab--active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>
        <div className="header-spacer" />
        <div className="header-actions">
          <LiveBanner liveState={liveState} />
          <button className="blank-btn" aria-pressed={liveState.hidden} onClick={toggleHidden}>
            {liveState.hidden ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 3l18 18M10.6 5.1A9.9 9.9 0 0112 5c5 0 9 4.5 10 7-.5 1.2-1.5 2.8-3 4.2M6.5 6.6C4.4 8 3 10.2 2 12c1 2.5 5 7 10 7 1.7 0 3.2-.5 4.5-1.2" />
              </svg>
            )}
            {liveState.hidden ? 'Restore the screen' : 'Blank the screen'}
          </button>
          <div className="header-divider" />
          <div role="group" aria-label="Appearance" className="theme-toggle">
            <button
              type="button"
              aria-label="Light theme"
              aria-pressed={theme === 'light'}
              className="theme-toggle__cell"
              onClick={() => chooseTheme('light')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 1.8v2.2M12 20v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M1.8 12h2.2M20 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Dark theme"
              aria-pressed={theme === 'dark'}
              className="theme-toggle__cell"
              onClick={() => chooseTheme('dark')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {view === 'settings' ? (
        <SettingsScreen onTranslationChange={setTranslation} />
      ) : (
        <div className="app-body">
          <div className="sidebar">
            <SearchPanel translation={translation} onStaged={handleStaged} onOpenChange={setSearchOpen} />
            <div className="service-header">
              <span className="service-header__label">Ready for today</span>
              <span className="service-header__count">{items.length} items</span>
              <div className="tabs-spacer" />
              <button
                type="button"
                className="service-header__add"
                onClick={() => document.getElementById('search-input')?.focus()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add
              </button>
            </div>
            <div className={`service-list-wrap ${searchOpen ? 'service-list-wrap--dimmed' : ''}`}>
              <StagedList
                items={items}
                activeItemId={activeItem?.id ?? null}
                liveStagedItemId={liveState.stagedItemId}
                onSelectActive={selectActive}
                onChanged={refreshStagedItems}
              />
            </div>
          </div>
          <ContentPane
            activeItem={activeItem}
            liveState={liveState}
            focusEntryId={focusEntryId}
            translation={translation}
            onFocusHandled={clearFocusEntry}
            onLive={() => window.api.getLiveState().then(setLiveStateValue)}
          />
        </div>
      )}
    </div>
  );
}
