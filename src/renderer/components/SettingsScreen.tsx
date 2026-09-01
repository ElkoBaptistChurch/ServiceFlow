import { useEffect, useState } from 'react';
import type { ContentType, ImportError, ImportSummary, OutputStyle } from '../../shared/types';

// Importers pass raw SQLite error text straight through as `reason` alongside their own
// hand-authored sentences (e.g. "song has no lyrics data"). A volunteer can't parse
// "NOT NULL constraint failed: bible_verses.text" -- flag it as technical rather than
// pretend it explains anything.
const RAW_SQLITE_TEXT = /constraint failed|no such (?:column|table)|SQLITE_/i;

function describeSkipReason(reason: string): string {
  return RAW_SQLITE_TEXT.test(reason) ? `technical detail: ${reason}` : reason;
}

interface Props {
  /** Lets App re-render search/content against the newly chosen translation. */
  onTranslationChange: (translation: string) => void;
}

export default function SettingsScreen({ onTranslationChange }: Props) {
  const [urls, setUrls] = useState<{ local: string; lan: string | null } | null>(null);
  // Distinguishes "haven't fetched yet" from "fetched and got nothing" so a failed or
  // null response shows an explicit error rather than silently hiding the whole section.
  const [urlsFailed, setUrlsFailed] = useState(false);
  const [bibleStyles, setBibleStyles] = useState<OutputStyle[]>([]);
  const [songStyles, setSongStyles] = useState<OutputStyle[]>([]);
  const [translations, setTranslations] = useState<string[]>([]);
  const [translation, setTranslation] = useState<string>('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  // Which URL was just copied, so the button can confirm it worked. A non-technical
  // volunteer hand-transcribing an IP-and-port URL into OBS is exactly the situation a
  // silent no-op (or a silent throw, if navigator.clipboard is unavailable) would hurt.
  const [justCopied, setJustCopied] = useState<'local' | 'lan' | null>(null);

  async function copyUrl(kind: 'local' | 'lan', url: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setJustCopied(kind);
      setTimeout(() => setJustCopied((current) => (current === kind ? null : current)), 2000);
    } catch {
      // Clipboard access can be unavailable or rejected (older OBS embedded browsers,
      // permissions, non-secure context). Fail quietly rather than throwing -- the URL is
      // still right there in plain text for the operator to select and copy by hand.
    }
  }

  const loadTranslations = () => {
    window.api.listTranslations().then(setTranslations);
    window.api.getActiveTranslation().then((t) => setTranslation(t ?? ''));
  };

  const loadServerUrls = () => {
    setUrlsFailed(false);
    window.api
      .getServerUrls()
      .then((result) => {
        if (result) setUrls(result);
        else setUrlsFailed(true);
      })
      .catch(() => setUrlsFailed(true));
  };

  useEffect(() => {
    loadServerUrls();
    window.api.getOutputStyles('bible').then(setBibleStyles);
    window.api.getOutputStyles('song').then(setSongStyles);
    loadTranslations();
  }, []);

  async function chooseTranslation(next: string) {
    await window.api.setActiveTranslation(next);
    setTranslation(next);
    onTranslationChange(next);
  }

  async function chooseStyle(contentType: ContentType, styleId: number) {
    await window.api.setActiveStyle(contentType, styleId);
    if (contentType === 'bible') setBibleStyles(await window.api.getOutputStyles('bible'));
    else setSongStyles(await window.api.getOutputStyles('song'));
  }

  async function runImport() {
    if (importing) return;
    setImporting(true);
    try {
      const files = await window.api.pickOpenlpFiles();
      if (files.length === 0) return;
      // The main process classifies each file by its schema — no filename guessing here.
      setSummary(await window.api.importOpenlp(files));
      loadTranslations();
    } finally {
      setImporting(false);
    }
  }

  function styleSection(contentType: ContentType, styles: OutputStyle[]) {
    return (
      <div>
        <h3>{contentType === 'bible' ? 'Bible style' : 'Song style'}</h3>
        {styles.map((s) => (
          <button
            key={s.id}
            aria-pressed={s.isActive}
            aria-label={`${contentType} ${s.name}`}
            onClick={() => chooseStyle(contentType, s.id)}
          >
            {s.name} {s.isActive ? '(active)' : ''}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2>Settings</h2>
      <section>
        <h3>OBS Browser Source URLs</h3>
        {urls && (
          <ul>
            <li>
              Same computer: <span>{urls.local}</span>{' '}
              <button type="button" aria-label="Copy same-computer URL" onClick={() => copyUrl('local', urls.local)}>
                {justCopied === 'local' ? 'Copied!' : 'Copy'}
              </button>
            </li>
            {urls.lan && (
              <li>
                Same network (other computer): <span>{urls.lan}</span>{' '}
                <button
                  type="button"
                  aria-label="Copy same-network URL"
                  onClick={() => copyUrl('lan', urls.lan as string)}
                >
                  {justCopied === 'lan' ? 'Copied!' : 'Copy'}
                </button>
              </li>
            )}
          </ul>
        )}
        {urlsFailed && (
          <p>
            Could not load the server URLs.{' '}
            <button type="button" aria-label="Refresh server URLs" onClick={loadServerUrls}>
              Refresh
            </button>
          </p>
        )}
        <p>
          In OBS: Sources → + → Browser Source → paste one of the URLs above → set width/height to your stream
          resolution → check "Shutdown source when not visible" off.
        </p>
      </section>
      <section>
        <h3>Bible translation</h3>
        <label htmlFor="translation-select">Bible translation</label>
        <select
          id="translation-select"
          value={translation}
          onChange={(e) => chooseTranslation(e.target.value)}
        >
          {/* Two independent async loads: the active translation can arrive as a value
              the list doesn't contain. Rather than let the browser silently fall back to
              selecting the first option, show the stored value as its own disabled entry
              so the dropdown never disagrees with what's actually in effect. */}
          {translation !== '' && !translations.includes(translation) && (
            <option value={translation} disabled>
              {translation} (not imported)
            </option>
          )}
          {translations.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {translations.length === 0 && <p>No translations imported yet.</p>}
      </section>
      {styleSection('bible', bibleStyles)}
      {styleSection('song', songStyles)}
      <section>
        <h3>Import from OpenLP</h3>
        <p>Pick your OpenLP song database and any Bible translation files — ServiceFlow works out which is which.</p>
        <button onClick={runImport} disabled={importing}>
          {importing ? 'Importing…' : 'Import from OpenLP'}
        </button>
        {summary && (
          <ul>
            {summary.sources.map((s, i) => (
              <li key={i}>
                {s.file} ({s.kind}
                {s.translation ? `, ${s.translation}` : ''}): {s.imported.toLocaleString()} imported,{' '}
                {s.skipped} skipped
                {s.errors.length > 0 && (
                  <ul>
                    {s.errors.slice(0, 5).map((e: ImportError, j) => (
                      <li key={j}>
                        {e.identifier} — {describeSkipReason(e.reason)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
