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
});
