import { describe, it, expect } from 'vitest';
import { mapOpenlpBook } from '../../../../src/main/import/openlp/bookMap';

const row = (name: string | null, ref: number | null, testament: number | null) => ({
  id: 1,
  name,
  book_reference_id: ref,
  testament_reference_id: testament,
});

describe('mapOpenlpBook', () => {
  it('maps a canonical book by its reference id when the name agrees', () => {
    expect(mapOpenlpBook(row('Romans', 45, 2))).toEqual({ ok: true, book: expect.objectContaining({ code: 'ROM' }) });
  });

  it('trusts the name over the reference id when they disagree, with a warning', () => {
    const mapping = mapOpenlpBook(row('Acts', 45, 2));
    expect(mapping.ok && mapping.book.code).toBe('ACT');
    expect(mapping.ok && mapping.warning).toMatch(/Romans/);
  });

  it('maps apocryphal books by name only', () => {
    expect(mapOpenlpBook(row('Tobit', 67, 3))).toEqual({ ok: true, book: expect.objectContaining({ code: 'TOB' }) });
    // Testament 3 with an in-range reference id still goes by name.
    expect(mapOpenlpBook(row('Wisdom', 5, 3))).toEqual({ ok: true, book: expect.objectContaining({ code: 'WIS' }) });
  });

  it('never guesses at an apocryphal book it cannot name', () => {
    expect(mapOpenlpBook(row('Book of Jasher', 90, 3))).toEqual({ ok: false, reason: expect.stringMatching(/Jasher/) });
    expect(mapOpenlpBook(row(null, 90, 3)).ok).toBe(false);
    expect(mapOpenlpBook(row('Mystery', null, 1)).ok).toBe(false);
  });
});
