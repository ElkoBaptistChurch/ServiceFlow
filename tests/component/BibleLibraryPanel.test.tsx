import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BibleLibraryPanel from '../../src/renderer/components/BibleLibraryPanel';

const KJV = { code: 'KJV', name: 'King James Version', source: 'bundled', licenseNote: 'Public domain (US).', bookCount: 66, verseCount: 31102 };
const NET = { code: 'NET', name: 'New English Translation', source: 'openlp', licenseNote: null, bookCount: 2, verseCount: 106 };

beforeEach(() => {
  (window as any).api = {
    listTranslations: vi.fn().mockResolvedValue([KJV, NET]),
    deleteTranslation: vi.fn().mockResolvedValue({ activeTranslation: 'NET' }),
    restoreBundledBible: vi.fn().mockResolvedValue({
      file: 'kjv.json',
      kind: 'bible',
      translation: 'KJV',
      imported: 31102,
      skipped: 0,
      errors: [],
    }),
    pickOpenlp: vi.fn().mockResolvedValue(['/openlp/data/bibles/NET.sqlite']),
    importOpenlpBibles: vi.fn().mockResolvedValue({
      sources: [{ file: 'NET.sqlite', kind: 'bible', translation: 'NET', imported: 106, skipped: 0, errors: [] }],
      imported: 106,
      skipped: 0,
      errors: [],
    }),
  };
});

function row(code: string): HTMLElement {
  return screen.getByText(code, { selector: '.bible-row__code' }).closest('li') as HTMLElement;
}

describe('BibleLibraryPanel', () => {
  it('lists each translation with its source, counts and a Partial badge for incomplete files', async () => {
    render(<BibleLibraryPanel />);
    await screen.findByText('King James Version');

    const kjv = within(row('KJV'));
    expect(kjv.getByText('Bundled')).toBeInTheDocument();
    expect(kjv.getByText(/66 books · 31,102 verses/)).toBeInTheDocument();
    expect(kjv.queryByText('Partial')).toBeNull();

    const net = within(row('NET'));
    expect(net.getByText('OpenLP')).toBeInTheDocument();
    expect(net.getByText(/2 books · 106 verses/)).toBeInTheDocument();
    expect(net.getByText('Partial')).toBeInTheDocument();
  });

  it('deletes a translation only after the in-app confirm, warning about staged items', async () => {
    const onContentChanged = vi.fn();
    render(<BibleLibraryPanel onContentChanged={onContentChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete KJV' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/service list/i);
    expect(window.api.deleteTranslation).not.toHaveBeenCalled();

    (window.api.listTranslations as any).mockResolvedValue([NET]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(window.api.deleteTranslation).toHaveBeenCalledWith('KJV'));
    await waitFor(() => expect(screen.queryByText('King James Version')).toBeNull());
    expect(onContentChanged).toHaveBeenCalled();
  });

  it('does nothing when the delete is cancelled', async () => {
    render(<BibleLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete KJV' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.api.deleteTranslation).not.toHaveBeenCalled();
  });

  it('offers Restore bundled KJV only when there is no KJV, and restores it', async () => {
    const { unmount } = render(<BibleLibraryPanel />);
    await screen.findByText('King James Version');
    expect(screen.queryByRole('button', { name: /restore bundled kjv/i })).toBeNull();
    unmount();

    (window.api.listTranslations as any).mockResolvedValue([NET]);
    const onContentChanged = vi.fn();
    render(<BibleLibraryPanel onContentChanged={onContentChanged} />);
    const restore = await screen.findByRole('button', { name: /restore bundled kjv/i });

    (window.api.listTranslations as any).mockResolvedValue([KJV, NET]);
    fireEvent.click(restore);

    await waitFor(() => expect(window.api.restoreBundledBible).toHaveBeenCalledWith('KJV'));
    expect(await screen.findByText(/kjv\.json \(bible, KJV\).*31,102 imported/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /restore bundled kjv/i })).toBeNull());
    expect(onContentChanged).toHaveBeenCalled();
  });

  it('imports Bibles from OpenLP, shows the summary inline and refreshes the list', async () => {
    (window.api.listTranslations as any).mockResolvedValue([KJV]);
    const onContentChanged = vi.fn();
    render(<BibleLibraryPanel onContentChanged={onContentChanged} />);
    await screen.findByText('King James Version');

    (window.api.listTranslations as any).mockResolvedValue([KJV, NET]);
    fireEvent.click(screen.getByRole('button', { name: /import from openlp/i }));

    await waitFor(() => expect(window.api.pickOpenlp).toHaveBeenCalledWith('bible'));
    await waitFor(() => expect(window.api.importOpenlpBibles).toHaveBeenCalledWith(['/openlp/data/bibles/NET.sqlite']));
    expect(await screen.findByText(/NET\.sqlite \(bible, NET\): 106 imported/)).toBeInTheDocument();
    expect(await screen.findByText('New English Translation')).toBeInTheDocument();
    expect(onContentChanged).toHaveBeenCalled();
  });

  it('does not import when the file dialog is cancelled', async () => {
    (window.api.pickOpenlp as any).mockResolvedValue([]);
    render(<BibleLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /import from openlp/i }));
    await waitFor(() => expect(window.api.pickOpenlp).toHaveBeenCalled());
    expect(window.api.importOpenlpBibles).not.toHaveBeenCalled();
  });

  it('shows an empty state when no Bible is installed', async () => {
    (window.api.listTranslations as any).mockResolvedValue([]);
    render(<BibleLibraryPanel />);
    expect(await screen.findByText(/No Bibles installed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore bundled kjv/i })).toBeInTheDocument();
  });

  it('shows a failed delete as an error instead of swallowing it', async () => {
    (window.api.deleteTranslation as any).mockRejectedValue(new Error('database is locked'));
    render(<BibleLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete KJV' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked');
  });
});
