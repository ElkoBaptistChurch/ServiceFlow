import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LibraryScreen from '../../src/renderer/components/LibraryScreen';

beforeEach(() => {
  (window as any).api = {
    findSongsByTitle: vi.fn().mockResolvedValue([]),
    getBlocksForSong: vi.fn().mockResolvedValue([]),
  };
});

describe('LibraryScreen', () => {
  it('shows Songs as the selected content type and renders the song library panel', async () => {
    render(<LibraryScreen />);
    expect(screen.getByRole('button', { name: 'Songs' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: /new song/i })).toBeInTheDocument();
  });
});
