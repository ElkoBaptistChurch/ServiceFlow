import { useEffect, useState } from 'react';
import type { BibleSource, BibleTranslation, ImportSummary } from '../../shared/types';
import ConfirmDialog, { ConfirmState } from './ConfirmDialog';
import ImportSummaryList from './ImportSummaryList';

/** The bundled translation *Restore* brings back. */
const BUNDLED_CODE = 'KJV';
/** Verses in a complete 66-book Bible (KJV versification). */
const FULL_BIBLE_VERSES = 31102;
// Below this a translation is flagged Partial — the church's NET and NKJV OpenLP files
// hold 106 and 152 verses (D6), and the operator should see that before Sunday, not
// during it.
const PARTIAL_THRESHOLD = 0.9;

const SOURCE_LABEL: Record<BibleSource, string> = { bundled: 'Bundled', openlp: 'OpenLP', file: 'File' };

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
}

export default function BibleLibraryPanel({ onContentChanged }: { onContentChanged?: () => void }) {
  const [translations, setTranslations] = useState<BibleTranslation[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const refresh = () =>
    window.api
      .listTranslations()
      .then(setTranslations)
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    refresh();
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function requestDelete(t: BibleTranslation) {
    setConfirmState({
      message:
        `Delete ${t.code} — ${t.name}? Its ${t.verseCount.toLocaleString()} verses are removed, and anything ` +
        `from ${t.code} in today's service list is taken off it (and off the screen, if it's showing).`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        setConfirmState(null);
        run(async () => {
          await window.api.deleteTranslation(t.code);
          await refresh();
          onContentChanged?.();
        });
      },
      onCancel: () => setConfirmState(null),
    });
  }

  function restoreBundled() {
    run(async () => {
      const result = await window.api.restoreBundledBible(BUNDLED_CODE);
      setSummary({ sources: [result], imported: result.imported, skipped: result.skipped, errors: result.errors });
      await refresh();
      onContentChanged?.();
    });
  }

  function importFromOpenlp() {
    run(async () => {
      const files = await window.api.pickOpenlp('bible');
      if (files.length === 0) return;
      setSummary(await window.api.importOpenlpBibles(files));
      await refresh();
      onContentChanged?.();
    });
  }

  const hasBundled = translations?.some((t) => t.code.toUpperCase() === BUNDLED_CODE) ?? true;

  return (
    <div className="bible-library">
      {confirmState && <ConfirmDialog state={confirmState} />}
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
      <div className="library-panel__header">
        <h2 className="library-panel__title">Bibles</h2>
        <div className="header-spacer" />
        {!hasBundled && (
          <button type="button" className="btn-pill btn-pill--small" onClick={restoreBundled} disabled={busy}>
            Restore bundled KJV
          </button>
        )}
        <button
          type="button"
          className="btn-pill btn-pill--small btn-pill--secondary"
          onClick={importFromOpenlp}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Import from OpenLP…'}
        </button>
      </div>

      {translations && translations.length === 0 && (
        <p className="library-empty">No Bibles installed. Restore the bundled KJV, or import one from OpenLP.</p>
      )}

      {translations && translations.length > 0 && (
        <ul className="bible-library__list" aria-label="Installed Bibles">
          {translations.map((t) => {
            const partial = t.verseCount < FULL_BIBLE_VERSES * PARTIAL_THRESHOLD;
            return (
              <li key={t.code} className="bible-row">
                <div className="bible-row__main">
                  <span className="bible-row__code">{t.code}</span>
                  <span className="bible-row__name">{t.name}</span>
                  <span className={`badge badge--${t.source}`}>{SOURCE_LABEL[t.source] ?? t.source}</span>
                  {partial && (
                    <span
                      className="badge badge--warning"
                      title="This file doesn't contain the whole Bible — some passages won't be found."
                    >
                      Partial
                    </span>
                  )}
                </div>
                <span className="bible-row__counts">
                  {t.bookCount} book{t.bookCount === 1 ? '' : 's'} · {t.verseCount.toLocaleString()} verse
                  {t.verseCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="btn-pill btn-pill--danger btn-pill--small"
                  aria-label={`Delete ${t.code}`}
                  onClick={() => requestDelete(t)}
                  disabled={busy}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {summary && <ImportSummaryList summary={summary} />}
    </div>
  );
}
