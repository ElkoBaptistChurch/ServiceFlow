import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    listTranslations: vi.fn().mockResolvedValue(TRANSLATIONS),
    getActiveTranslation: vi.fn().mockResolvedValue('KJV'),
    setActiveTranslation: vi.fn().mockResolvedValue(undefined),
  };
});

const TRANSLATIONS = [
  { code: 'KJV', name: 'King James Version', source: 'bundled', licenseNote: null, bookCount: 66, verseCount: 31102 },
  { code: 'NET', name: 'New English Translation', source: 'openlp', licenseNote: null, bookCount: 2, verseCount: 106 },
];

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

  it('lists translations as "code — name" and stores the code', async () => {
    const onTranslationChange = vi.fn();
    render(<SettingsScreen onTranslationChange={onTranslationChange} />);
    const select = await screen.findByLabelText(/bible translation/i);
    expect(await screen.findByRole('option', { name: 'KJV — King James Version' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'NET — New English Translation' })).toHaveValue('NET');

    fireEvent.change(select, { target: { value: 'NET' } });

    await waitFor(() => expect(window.api.setActiveTranslation).toHaveBeenCalledWith('NET'));
    expect(onTranslationChange).toHaveBeenCalledWith('NET');
  });

  // R-15: the dropdown must never silently disagree with the effective translation.
  it('never shows a translation that is not the active one', async () => {
    (window.api.getActiveTranslation as any).mockResolvedValue('NIV');

    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    const select = (await screen.findByLabelText(/bible translation/i)) as HTMLSelectElement;

    await waitFor(() => expect(select.value).toBe('NIV'));
    expect(screen.getByRole('option', { name: /NIV \(not installed\)/i })).toBeInTheDocument();
  });

  it('points to Library → Bibles when no Bible is installed', async () => {
    (window.api.listTranslations as any).mockResolvedValue([]);
    (window.api.getActiveTranslation as any).mockResolvedValue(null);
    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    expect(await screen.findByText(/No Bibles installed — add one in Library → Bibles/)).toBeInTheDocument();
  });

  // D12: each content type's import now lives next to that content in the Library.
  it('no longer has an import section', async () => {
    render(<SettingsScreen onTranslationChange={vi.fn()} />);
    await screen.findByText('http://localhost:4180/output');
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    expect(screen.queryByText(/import from openlp/i)).toBeNull();
  });

  // R-16: a failed or empty URL fetch must show an explicit error state, not vanish silently.
  it('shows an error state when server URLs cannot be loaded', async () => {
    (window.api.getServerUrls as any).mockResolvedValue(null);

    render(<SettingsScreen onTranslationChange={vi.fn()} />);

    expect(await screen.findByText(/could not load|unable to load|error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('shows the current verse list density and reports a change', async () => {
    const onDensityChange = vi.fn();
    render(<SettingsScreen onTranslationChange={vi.fn()} density="compact" onDensityChange={onDensityChange} />);
    const group = await screen.findByRole('group', { name: /verse list density/i });
    const compact = within(group).getByRole('button', { name: 'Compact' });
    const spacious = within(group).getByRole('button', { name: 'Spacious' });
    expect(compact).toHaveAttribute('aria-pressed', 'true');
    expect(spacious).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(spacious);
    expect(onDensityChange).toHaveBeenCalledWith('spacious');
  });
});
