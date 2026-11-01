import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImportSummaryList from '../../src/renderer/components/ImportSummaryList';

describe('ImportSummaryList', () => {
  // A single merged count tells the operator nothing about whether each file arrived.
  it('reports each file separately', () => {
    render(
      <ImportSummaryList
        summary={{
          sources: [
            { file: 'songs.sqlite', kind: 'songs', imported: 556, skipped: 0, errors: [] },
            { file: 'KJV.sqlite', kind: 'bible', translation: 'KJV', imported: 36503, skipped: 0, errors: [] },
          ],
          imported: 37059,
          skipped: 0,
          errors: [],
        }}
      />
    );
    expect(screen.getByText(/songs\.sqlite.*556/i)).toBeInTheDocument();
    expect(screen.getByText(/KJV\.sqlite \(bible, KJV\).*36,?503/i)).toBeInTheDocument();
  });

  // I-08: the volunteer needs to know WHY an item was skipped, not just its identifier.
  it('shows the reason each item was skipped, flagging raw SQLite text as technical', () => {
    render(
      <ImportSummaryList
        summary={{
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
        }}
      />
    );
    expect(screen.getByText(/Broken Song — song has no lyrics data/)).toBeInTheDocument();
    expect(screen.getByText(/technical detail:.*NOT NULL constraint failed/)).toBeInTheDocument();
  });

  // I-09a: two picked files with the same basename must not produce duplicate React keys.
  it('renders two files with the same basename', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ImportSummaryList
        summary={{
          sources: [
            { file: 'bible.sqlite', kind: 'bible', translation: 'KJV', imported: 100, skipped: 0, errors: [] },
            { file: 'bible.sqlite', kind: 'bible', translation: 'NET', imported: 200, skipped: 0, errors: [] },
          ],
          imported: 300,
          skipped: 0,
          errors: [],
        }}
      />
    );
    expect(screen.getByText(/bible\.sqlite.*100/i)).toBeInTheDocument();
    expect(screen.getByText(/bible\.sqlite.*200/i)).toBeInTheDocument();
    expect(errorSpy.mock.calls.some((call) => /duplicate key/i.test(String(call[0])))).toBe(false);
    errorSpy.mockRestore();
  });
});
