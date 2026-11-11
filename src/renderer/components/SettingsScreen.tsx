import { useEffect, useState } from 'react';
import type { BibleTranslation, ContentType, Density, OutputStyle } from '../../shared/types';
import StyleCard from './StyleCard';
import StylePreviewModal from './StylePreviewModal';

interface Props {
  /** Lets App re-render search/content against the newly chosen translation. */
  onTranslationChange: (translation: string) => void;
  /** Owned by App because it is applied to the document root, like the theme. */
  density?: Density;
  onDensityChange?: (density: Density) => void;
}

const DENSITY_OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: 'compact', label: 'Compact', hint: 'Smaller text, tight rows — more verses on screen' },
  { value: 'spacious', label: 'Spacious', hint: 'Larger text with more room between verses' },
];

export default function SettingsScreen({ onTranslationChange, density = 'compact', onDensityChange }: Props) {
  const [urls, setUrls] = useState<{ local: string; lan: string | null } | null>(null);
  // Distinguishes "haven't fetched yet" from "fetched and got nothing" so a failed or
  // null response shows an explicit error rather than silently hiding the whole section.
  const [urlsFailed, setUrlsFailed] = useState(false);
  const [bibleStyles, setBibleStyles] = useState<OutputStyle[]>([]);
  const [songStyles, setSongStyles] = useState<OutputStyle[]>([]);
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [translation, setTranslation] = useState<string>('');
  // Which URL was just copied, so the button can confirm it worked. A non-technical
  // volunteer hand-transcribing an IP-and-port URL into OBS is exactly the situation a
  // silent no-op (or a silent throw, if navigator.clipboard is unavailable) would hurt.
  const [justCopied, setJustCopied] = useState<'local' | 'lan' | null>(null);
  const [zoomStyle, setZoomStyle] = useState<{ contentType: ContentType; style: OutputStyle } | null>(null);

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

  function styleSection(contentType: ContentType, styles: OutputStyle[]) {
    return (
      <section className="settings-section">
        <h3 className="settings-section__title">{contentType === 'bible' ? 'Bible style' : 'Song style'}</h3>
        <div className="style-grid">
          {styles.map((s) => (
            <StyleCard
              key={s.id}
              contentType={contentType}
              style={s}
              onSelect={(styleId) => chooseStyle(contentType, styleId)}
              onZoom={(style) => setZoomStyle({ contentType, style })}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <>
    <div className="settings-page">
      <h2 className="settings-page__title">Settings</h2>
      <section className="settings-section">
        <h3 className="settings-section__title">OBS Browser Source URLs</h3>
        {urls && (
          <ul className="url-list">
            <li className="url-row">
              Same computer: <code>{urls.local}</code>
              <button
                type="button"
                className="btn-pill"
                aria-label="Copy same-computer URL"
                onClick={() => copyUrl('local', urls.local)}
              >
                {justCopied === 'local' ? 'Copied!' : 'Copy'}
              </button>
            </li>
            {urls.lan && (
              <li className="url-row">
                Same network (other computer): <code>{urls.lan}</code>
                <button
                  type="button"
                  className="btn-pill"
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
          <p className="settings-section__body">
            Could not load the server URLs.{' '}
            <button type="button" className="btn-pill" aria-label="Refresh server URLs" onClick={loadServerUrls}>
              Refresh
            </button>
          </p>
        )}
        <p className="settings-section__body">
          In OBS: Sources → + → Browser Source → paste one of the URLs above → set width/height to your stream
          resolution → check "Shutdown source when not visible" off.
        </p>
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">Bible translation</h3>
        <label className="field-label" htmlFor="translation-select">
          Bible translation
        </label>
        <select
          id="translation-select"
          className="field-select"
          value={translation}
          onChange={(e) => chooseTranslation(e.target.value)}
        >
          {/* Two independent async loads: the active translation can arrive as a value
              the list doesn't contain. Rather than let the browser silently fall back to
              selecting the first option, show the stored value as its own disabled entry
              so the dropdown never disagrees with what's actually in effect. */}
          {translation !== '' && !translations.some((t) => t.code === translation) && (
            <option value={translation} disabled>
              {translation} (not installed)
            </option>
          )}
          {translations.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code === t.name ? t.code : `${t.code} — ${t.name}`}
            </option>
          ))}
        </select>
        {translations.length === 0 && (
          <p className="settings-section__body">No Bibles installed — add one in Library → Bibles.</p>
        )}
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">Verse list density</h3>
        <div role="group" aria-label="Verse list density" className="density-toggle">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="density-toggle__cell"
              aria-pressed={density === opt.value}
              onClick={() => onDensityChange?.(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="settings-section__body">
          {DENSITY_OPTIONS.find((o) => o.value === density)?.hint}. Affects this screen only, not the stream output.
        </p>
      </section>
      {styleSection('bible', bibleStyles)}
      {styleSection('song', songStyles)}
    </div>
    {zoomStyle && (
      <StylePreviewModal
        contentType={zoomStyle.contentType}
        style={zoomStyle.style}
        onClose={() => setZoomStyle(null)}
      />
    )}
    </>
  );
}
