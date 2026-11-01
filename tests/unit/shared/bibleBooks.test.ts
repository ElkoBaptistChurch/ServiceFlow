import { describe, it, expect } from 'vitest';
import {
  CANONICAL_BOOKS,
  bookByCode,
  bookCodesMatchingQuery,
  matchBookByName,
} from '../../../src/shared/bibleBooks';

// The 12 apocryphal book names as OpenLP's KJV file spells them (D7: ids 67-78; id 69,
// "Esdras", shares book_reference_id 15 with Ezra), plus the spellings other OpenLP
// Bible downloads use for the same books.
const OPENLP_KJV_APOCRYPHA: [string, string][] = [
  ['Tobit', 'TOB'],
  ['Judith', 'JDT'],
  ['Esdras', '1ES'],
  ['1 Esdras', '1ES'],
  ['2 Esdras', '2ES'],
  ['Rest of Esther', 'ESG'],
  ['Wisdom', 'WIS'],
  ['Wisdom of Solomon', 'WIS'],
  ['Sirach', 'SIR'],
  ['Ecclesiasticus', 'SIR'],
  ['Baruch', 'BAR'],
  ['1 Maccabees', '1MA'],
  ['2 Maccabees', '2MA'],
  ['Prayer of Manasses', 'MAN'],
  ['Prayer of Manasseh', 'MAN'],
  ['Song of the Three Children', 'S3Y'],
  ['Prayer of Azariah', 'S3Y'],
  ['Susanna', 'SUS'],
  ['Bel and the Dragon', 'BEL'],
];

describe('CANONICAL_BOOKS', () => {
  it('has the 66 Protestant books in canonical order, Genesis to Revelation', () => {
    const protestant = CANONICAL_BOOKS.filter((b) => b.testament !== 'AP');
    expect(protestant).toHaveLength(66);
    expect(protestant.filter((b) => b.testament === 'OT')).toHaveLength(39);
    expect(protestant[0].code).toBe('GEN');
    expect(protestant[38].code).toBe('MAL');
    expect(protestant[39].code).toBe('MAT');
    expect(protestant[65].code).toBe('REV');
  });

  it('has unique codes and a contiguous 1-based order', () => {
    const codes = CANONICAL_BOOKS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    CANONICAL_BOOKS.forEach((b, i) => expect(b.order).toBe(i + 1));
  });

  it('carries the deuterocanonical books after the 66', () => {
    const ap = CANONICAL_BOOKS.filter((b) => b.testament === 'AP').map((b) => b.code);
    for (const code of ['TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR', '1MA', '2MA', '1ES', '2ES', 'MAN', 'S3Y', 'SUS', 'BEL']) {
      expect(ap).toContain(code);
    }
    expect(bookByCode('TOB')!.order).toBeGreaterThan(66);
  });
});

describe('bookByCode', () => {
  it('looks up by code, case-insensitively', () => {
    expect(bookByCode('JHN')!.name).toBe('John');
    expect(bookByCode('jhn')!.name).toBe('John');
    expect(bookByCode('XYZ')).toBeUndefined();
  });
});

describe('matchBookByName', () => {
  it.each(OPENLP_KJV_APOCRYPHA)('resolves the OpenLP KJV apocryphal book "%s"', (name, code) => {
    expect(matchBookByName(name)?.code).toBe(code);
  });

  it('does not let "1 John" and "John" collide', () => {
    expect(matchBookByName('John')!.code).toBe('JHN');
    expect(matchBookByName('1 John')!.code).toBe('1JN');
    expect(matchBookByName('I John')!.code).toBe('1JN');
    expect(matchBookByName('3 John')!.code).toBe('3JN');
  });

  it('is case-, punctuation- and roman-numeral-aware', () => {
    for (const name of ['1 Kings', 'I Kings', 'First Kings', '1st Kings', '1Kings', 'i kings', '1. Kings']) {
      expect(matchBookByName(name)?.code).toBe('1KI');
    }
    expect(matchBookByName('II Corinthians')!.code).toBe('2CO');
    expect(matchBookByName('song of songs')!.code).toBe('SNG');
    expect(matchBookByName('Canticles')!.code).toBe('SNG');
    expect(matchBookByName('The Revelation of John')!.code).toBe('REV');
    expect(matchBookByName('Psalm')!.code).toBe('PSA');
  });

  it('never guesses at an unknown name', () => {
    expect(matchBookByName('Hezekiah')).toBeUndefined();
    expect(matchBookByName('')).toBeUndefined();
    expect(matchBookByName('Kings')).toBeUndefined();
  });

  it('matches every canonical name to its own book', () => {
    for (const book of CANONICAL_BOOKS) expect(matchBookByName(book.name)?.code).toBe(book.code);
  });
});

describe('bookCodesMatchingQuery', () => {
  it('finds a book by an alias the translation may not use', () => {
    expect(bookCodesMatchingQuery('Song of Songs')).toContain('SNG');
    expect(bookCodesMatchingQuery('Ecclesiasticus')).toEqual(['SIR']);
    expect(bookCodesMatchingQuery('')).toEqual([]);
  });
});
