import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CANONICAL_BOOKS, bookByCode } from '../../../src/shared/bibleBooks';
import type { TranslationInput } from '../../../src/shared/types';

const kjv = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../resources/bibles/kjv.json'), 'utf8')
) as TranslationInput & { comment: string };

function verse(code: string, chapter: number, v: number): string | undefined {
  return kjv.books.find((b) => b.bookCode === code)?.verses.find(([c, n]) => c === chapter && n === v)?.[2];
}

describe('resources/bibles/kjv.json', () => {
  it('is the bundled KJV with its provenance recorded', () => {
    expect(kjv.code).toBe('KJV');
    expect(kjv.source).toBe('bundled');
    expect(kjv.licenseNote).toMatch(/public domain/i);
    expect(kjv.comment).toContain('https://ebible.org/Scriptures/eng-kjv_vpl.zip');
  });

  it('has exactly the 66 canonical books, in canonical order', () => {
    expect(kjv.books.map((b) => b.bookCode)).toEqual(
      CANONICAL_BOOKS.filter((b) => b.testament !== 'AP').map((b) => b.code)
    );
    for (const b of kjv.books) expect(bookByCode(b.bookCode)).toBeDefined();
  });

  it('has 31,102 verses and none are empty or carry markup', () => {
    const all = kjv.books.flatMap((b) => b.verses);
    expect(all).toHaveLength(31102);
    for (const [c, v, text] of all) {
      expect(Number.isInteger(c) && Number.isInteger(v)).toBe(true);
      expect(text.trim()).not.toBe('');
      expect(text).not.toMatch(/[¶[\]<>]|\s{2,}/);
    }
  });

  it('spot-checks well-known verses', () => {
    expect(verse('GEN', 1, 1)).toBe('In the beginning God created the heaven and the earth.');
    expect(verse('JHN', 3, 16)).toBe(
      'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'
    );
  });

  it('has Esther 8:9 as its longest verse', () => {
    const all = kjv.books.flatMap((b) => b.verses.map(([c, v, text]) => ({ ref: `${b.bookCode} ${c}:${v}`, text })));
    const longest = all.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    expect(longest.ref).toBe('EST 8:9');
    expect(longest.text).toMatch(/^Then were the king’s scribes called/);
  });

  it('has the right shape for short books and chapters', () => {
    const psalms = kjv.books.find((b) => b.bookCode === 'PSA')!;
    expect(psalms.verses.filter(([c]) => c === 117)).toHaveLength(2);
    const thirdJohn = kjv.books.find((b) => b.bookCode === '3JN')!;
    expect(thirdJohn.verses).toHaveLength(14);
  });
});
