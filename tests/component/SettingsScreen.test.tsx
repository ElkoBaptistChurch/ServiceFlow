import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsScreen from '../../src/renderer/components/SettingsScreen';

beforeEach(() => {
  (window as any).api = {
    getServerUrls: vi.fn().mockResolvedValue({ local: 'http://localhost:4180/output', lan: 'http://192.168.1.20:4180/output' }),
    getOutputStyles: vi.fn().mockImplementation((contentType: string) =>
      Promise.resolve([
        { id: 1, contentType, name: 'Classic Lower Third', templateKey: `${contentType}-classic`, settings: {}, isActive: true },
        { id: 2, contentType, name: 'Minimal Caption', templateKey: `${contentType}-minimal`, settings: {}, isActive: false },
      ])
    ),
    setActiveStyle: vi.fn().mockResolvedValue(undefined),
    listTranslations: vi.fn().mockResolvedValue(['KJV', 'New English Translation (NET)']),
    getActiveTranslation: vi.fn().mockResolvedValue('KJV'),
    setActiveTranslation: vi.fn().mockResolvedValue(undefined),
    pickOpenlpFiles: vi.fn().mockResolvedValue(['/path/to/songs.sqlite', '/path/to/KJV.sqlite']),
    importOpenlp: vi.fn().mockResolvedValue({
      sources: [
        { file: 'songs.sqlite', kind: 'songs', imported: 556, skipped: 0, errors: [] },
        { file: 'KJV.sqlite', kind: 'bible', translation: 'KJV', imported: 36503, skipped: 0, errors: [] },
      ],
      imported: 37059,
      skipped: 0,
      errors: [],
    }),
  };
});

describe('SettingsScreen', () => {
  it('shows the local and LAN output URLs', async () => {
    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    expect(await screen.findByText('http://localhost:4180/output')).toBeInTheDocument();
    expect(await screen.findByText('http://192.168.1.20:4180/output')).toBeInTheDocument();
  });

  // M3: the spec requires copy-to-clipboard buttons beside each URL, with visible
  // confirmation, for a non-technical volunteer hand-transcribing the URL into OBS.
  it('copies the local URL to the clipboard and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    await screen.findByText('http://localhost:4180/output');

    fireEvent.click(screen.getByRole('button', { name: /copy same-computer url/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:4180/output'));
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('copies the LAN URL independently from the local URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    await screen.findByText('http://192.168.1.20:4180/output');

    fireEvent.click(screen.getByRole('button', { name: /copy same-network url/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://192.168.1.20:4180/output'));
  });

  // navigator.clipboard is not guaranteed to exist (older OBS embedded browsers, jsdom by
  // default) and writeText() can reject (denied permission). Neither should throw and take
  // down the Settings screen -- the URL is still there in plain text to select by hand.
  it('does not throw when the clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    await screen.findByText('http://localhost:4180/output');

    expect(() => fireEvent.click(screen.getByRole('button', { name: /copy same-computer url/i }))).not.toThrow();
  });

  it('sets the active bible style independently from the song style', async () => {
    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    const bibleMinimal = await screen.findByRole('button', { name: /bible.*minimal caption/i });
    fireEvent.click(bibleMinimal);
    await waitFor(() => expect(window.api.setActiveStyle).toHaveBeenCalledWith('bible', 2));
  });

  it('lets the operator pick which translation the app searches', async () => {
    const onTranslationChange = vi.fn();
    render(<SettingsScreen onTranslationChange={onTranslationChange} />);
    const select = await screen.findByLabelText(/bible translation/i);
    fireEvent.change(select, { target: { value: 'New English Translation (NET)' } });
    await waitFor(() =>
      expect(window.api.setActiveTranslation).toHaveBeenCalledWith('New English Translation (NET)')
    );
    expect(onTranslationChange).toHaveBeenCalledWith('New English Translation (NET)');
  });

  // A single merged count ("37059 imported") tells the operator nothing about whether
  // their songs actually arrived. Report each file.
  it('runs an OpenLP import and reports each file separately', async () => {
    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /import from openlp/i }));
    await waitFor(() =>
      expect(window.api.importOpenlp).toHaveBeenCalledWith(['/path/to/songs.sqlite', '/path/to/KJV.sqlite'])
    );
    expect(await screen.findByText(/songs\.sqlite.*556/i)).toBeInTheDocument();
    expect(await screen.findByText(/KJV\.sqlite.*36,?503/i)).toBeInTheDocument();
  });

  // R-11: two clicks must not fire two concurrent imports of the same file.
  it('does not start a second import while one is running', async () => {
    let resolveImport: (v: any) => void;
    (window.api.importOpenlp as any).mockImplementation(
      () => new Promise((resolve) => { resolveImport = resolve; })
    );

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    const importButton = screen.getByRole('button', { name: /import from openlp/i });
    fireEvent.click(importButton);
    await waitFor(() => expect(window.api.pickOpenlpFiles).toHaveBeenCalledTimes(1));
    fireEvent.click(importButton);
    await new Promise((r) => setTimeout(r, 0));

    expect(window.api.pickOpenlpFiles).toHaveBeenCalledTimes(1);

    resolveImport!({ sources: [], imported: 0, skipped: 0, errors: [] });
    await waitFor(() => expect(importButton).not.toBeDisabled());
  });

  // R-15: the dropdown must never silently disagree with the effective translation.
  it('never shows a translation that is not the active one', async () => {
    (window.api.listTranslations as any).mockResolvedValue(['KJV', 'New English Translation (NET)']);
    (window.api.getActiveTranslation as any).mockResolvedValue('New International Version (NIV)');

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    const select = (await screen.findByLabelText(/bible translation/i)) as HTMLSelectElement;

    await waitFor(() => expect(select.value).toBe('New International Version (NIV)'));
    expect(screen.getByRole('option', { name: /New International Version \(NIV\)/i })).toBeInTheDocument();
  });

  // R-16: a failed or empty URL fetch must show an explicit error state, not vanish silently.
  it('shows an error state when server URLs cannot be loaded', async () => {
    (window.api.getServerUrls as any).mockResolvedValue(null);

    render(<SettingsScreen onTranslationChange={vi.fn()} />);

    expect(await screen.findByText(/could not load|unable to load|error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  // I-08: the volunteer needs to know WHY an item was skipped, not just its identifier.
  it('shows the reason each item was skipped', async () => {
    (window.api.importOpenlp as any).mockResolvedValue({
      sources: [
        {
          file: 'songs.sqlite',
          kind: 'songs',
          imported: 2,
          skipped: 2,
          errors: [
            { identifier: 'Broken Song', reason: 'song has no lyrics data' },
            { identifier: 'No Lyrics Song', reason: 'NOT NULL constraint failed: bible_verses.text' },
          ],
        },
      ],
      imported: 2,
      skipped: 2,
      errors: [],
    });

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /import from openlp/i }));

    expect(await screen.findByText(/Broken Song/)).toBeInTheDocument();
    expect(screen.getByText(/song has no lyrics data/)).toBeInTheDocument();
    expect(screen.getByText(/technical detail:.*NOT NULL constraint failed/)).toBeInTheDocument();
  });

  // I-09a: two picked files with the same basename must not produce duplicate React keys.
  it('renders a summary for two files with the same basename', async () => {
    (window.api.importOpenlp as any).mockResolvedValue({
      sources: [
        { file: 'bible.sqlite', kind: 'bible', translation: 'KJV', imported: 100, skipped: 0, errors: [] },
        { file: 'bible.sqlite', kind: 'bible', translation: 'NET', imported: 200, skipped: 0, errors: [] },
      ],
      imported: 300,
      skipped: 0,
      errors: [],
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /import from openlp/i }));

    expect(await screen.findByText(/bible\.sqlite.*100/i)).toBeInTheDocument();
    expect(screen.getByText(/bible\.sqlite.*200/i)).toBeInTheDocument();
    expect(errorSpy.mock.calls.some((call) => /duplicate key/i.test(String(call[0])))).toBe(false);
    errorSpy.mockRestore();
  });
});
